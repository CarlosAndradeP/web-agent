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

function parsePersistedModelMessages(value: string | null): Array<ModelMessage> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const messages: Array<ModelMessage> = [];
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') return null;
      const message = candidate as { role?: unknown; content?: unknown };
      if (message.role === 'assistant') {
        if (typeof message.content !== 'string' && !Array.isArray(message.content)) return null;
        messages.push(candidate as ModelMessage);
      } else if (message.role === 'tool') {
        if (!Array.isArray(message.content)) return null;
        messages.push(candidate as ModelMessage);
      } else {
        return null;
      }
    }
    return messages;
  } catch {
    return null;
  }
}

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

    // Keep recent turns verbatim, including the request that triggered compaction.
    const messages = this.messagesRepo.findBySession(sessionId).slice(0, -6);
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
    this.db.transaction(() => {
      if (this.sessionsRepo.getSummary(sessionId) !== previousSummary || messages.some(message => !this.db.prepare('SELECT 1 FROM messages WHERE id = ? AND session_id = ? AND is_compacted = 0').get(message.id, sessionId))) {
        throw new Error('Conversation changed during compaction; original history was preserved');
      }
      this.messagesRepo.compactSession(sessionId, summary, messages.map(m => m.id));
      this.sessionsRepo.updateSummary(sessionId, summary);
    })();

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
    const messages = this.messagesRepo.findForModelContext(sessionId);
    for (const msg of messages) {
      // Skip system messages that are the compacted summary (already included above)
      if (msg.role === 'system' && msg.content?.startsWith('[Conversation summary')) continue;
      // Only include user, assistant, and system roles that the LLM understands
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        if (msg.role === 'assistant') {
          const preservedMessages = parsePersistedModelMessages(msg.modelContext);
          if (preservedMessages) {
            context.push(...preservedMessages);
            try {
              const metadata = JSON.parse(msg.toolCalls ?? '{}');
              if (metadata.status && metadata.status !== 'completed') {
                context.push({ role: 'assistant', content: `[Previous task ${metadata.status}: ${metadata.error ?? 'interrupted'}. Work is incomplete. Continue from existing files and recorded tool results; verify before claiming completion.]` });
              }
            } catch { /* Legacy tool metadata may not be JSON. */ }
            continue;
          }
        }
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
        timeout: { totalMs: 60_000 },
      });

      if (result.finishReason !== 'stop' || !result.text.trim()) throw new Error('The provider did not return a complete compaction summary');
      return result.text;
    } catch (err: any) {
      log.error('Failed to generate summary; preserving original history', { error: err.message });
      throw err;
    }
  }

}
