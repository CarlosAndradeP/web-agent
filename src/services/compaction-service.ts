import type Database from 'better-sqlite3';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { MessagesRepository } from '../db/repositories/messages.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { createProvider } from '../agent/provider.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('CompactionService');

const COMPACT_PROMPT = `Summarize the following conversation concisely. Preserve:
1. What tasks were requested and whether they were completed
2. Key file paths created or modified
3. Important decisions made
4. Any errors encountered and their resolutions
5. Current state of the project/workspace

Be thorough but concise. This summary will replace the conversation history.`;

// Rough token estimation: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;
// Threshold: compact when estimated tokens exceed 80% of this value
const DEFAULT_MAX_ESTIMATED_TOKENS = 60000;

export class CompactionService {
  private messagesRepo: MessagesRepository;
  private sessionsRepo: SessionsRepository;
  private configRepo: ConfigRepository;

  constructor(private db: Database.Database) {
    this.messagesRepo = new MessagesRepository(db);
    this.sessionsRepo = new SessionsRepository(db);
    this.configRepo = new ConfigRepository(db);
  }

  /**
   * Check if a session needs compaction based on estimated token count.
   */
  needsCompaction(sessionId: string, model?: string): { needed: boolean; estimatedTokens: number; threshold: number } {
    const totalChars = this.messagesRepo.totalContentLength(sessionId);
    const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
    // Could look up model context length here for per-model thresholds
    const threshold = DEFAULT_MAX_ESTIMATED_TOKENS;
    return { needed: estimatedTokens > threshold, estimatedTokens, threshold };
  }

  /**
   * Compact a session: summarize all active messages and mark them as compacted.
   * Returns the summary text on success.
   */
  async compactSession(sessionId: string): Promise<string> {
    log.info('Starting compaction', { sessionId });

    const messages = this.messagesRepo.findBySession(sessionId);
    if (messages.length === 0) {
      log.info('No messages to compact', { sessionId });
      return 'No messages to compact.';
    }

    // Build conversation text for summarization — include the previous summary
    // (if any) so the new summary preserves long-term context across multiple
    // compactions instead of discarding it.
    const previousSummary = this.sessionsRepo.getSummary(sessionId);
    let conversationText: string;
    if (previousSummary) {
      conversationText = `[Previous conversation summary]:\n${previousSummary}\n\n--- Newer messages ---\n` +
        messages.map(m => `[${m.role}]: ${m.content || '(empty)'}`).join('\n\n');
    } else {
      conversationText = messages.map(m => `[${m.role}]: ${m.content || '(empty)'}`).join('\n\n');
    }

    // Call the LLM to generate a summary
    const summary = await this.generateSummary(conversationText);

    // Compact: insert summary message and mark old messages as compacted
    this.messagesRepo.compactSession(sessionId, summary);
    this.sessionsRepo.updateSummary(sessionId, summary);

    log.info('Compaction complete', { sessionId, summaryLength: summary.length });
    return summary;
  }

  /**
   * Auto-compact if needed, called before sending messages to the agent.
   * Returns true if compaction was performed.
   */
  async autoCompactIfNeeded(sessionId: string, model?: string): Promise<boolean> {
    const { needed } = this.needsCompaction(sessionId, model);
    if (!needed) return false;

    try {
      await this.compactSession(sessionId);
      return true;
    } catch (err: any) {
      log.error('Auto-compaction failed', { sessionId, error: err.message });
      return false;
    }
  }

  /**
   * Get the conversation context for a session, including any previous summary.
   * Returns an array of messages suitable for passing to the LLM.
   */
  getConversationContext(sessionId: string): Array<ModelMessage> {
    const context: Array<ModelMessage> = [];

    // Include previous summary if exists
    const summary = this.sessionsRepo.getSummary(sessionId);
    if (summary) {
      context.push({ role: 'system', content: `[Conversation summary from previous context]:\n${summary}` });
    }

    // Include all non-compacted messages
    const messages = this.messagesRepo.findBySession(sessionId);
    for (const msg of messages) {
      // Skip system messages that are the compacted summary (already included above)
      if (msg.role === 'system' && msg.content?.startsWith('[Conversation summary')) continue;
      // Only include user, assistant, and system roles that the LLM understands
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        context.push({ role: msg.role as 'user' | 'assistant' | 'system', content: msg.content || '' });
      }
    }

    return context;
  }

  private async generateSummary(conversationText: string): Promise<string> {
    const appConfig = this.configRepo.getAll();

    try {
      const provider = createProvider(appConfig.apiBaseUrl, appConfig.apiKey, appConfig.agentType);
      const model = provider.chatModel(appConfig.defaultModel);

      const { generateText } = await import('ai');
      const result = await generateText({
        model,
        prompt: `${COMPACT_PROMPT}\n\n---\n\n${conversationText}`,
        maxOutputTokens: 2048,
      });

      return result.text || 'Conversation compacted (summary unavailable).';
    } catch (err: any) {
      log.error('Failed to generate summary via LLM, using fallback', { error: err.message });
      // Fallback: create a simple summary from the last few messages
      return this.fallbackSummary(conversationText);
    }
  }

  private fallbackSummary(conversationText: string): string {
    const lines = conversationText.split('\n').filter(l => l.trim());
    const totalLines = lines.length;
    if (totalLines <= 10) {
      return `[Compact summary - original conversation had ${totalLines} entries]:\n${lines.join('\n')}`;
    }
    // Keep first 5 (context) and last 5 (recent)
    const head = lines.slice(0, 5);
    const tail = lines.slice(-5);
    return `[Compact summary - original conversation had ${totalLines} entries. Showing first 5 and last 5]:\n${head.join('\n')}\n...\n${tail.join('\n')}`;
  }
}
