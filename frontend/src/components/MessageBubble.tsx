import type { ToolCallInfo } from '../hooks/useChat';
import ToolCallDisplay from './ToolCallDisplay';
import MarkdownRenderer from './MarkdownRenderer';
import { Bot, User, Info } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

export default function MessageBubble({ role, content, toolCalls, isStreaming }: Props) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasContent = content.trim().length > 0;

  return (
    <div className={cn('flex gap-3 animate-in', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && !isSystem && (
        <div className="shrink-0 mt-1">
          <div className="h-7 w-7 rounded-lg bg-zinc-800/80 border border-zinc-700/40 flex items-center justify-center">
            <Bot className="h-4 w-4 text-blue-400" />
          </div>
        </div>
      )}
      {isSystem && (
        <div className="shrink-0 mt-1">
          <div className="h-7 w-7 rounded-lg bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center">
            <Info className="h-4 w-4 text-zinc-400" />
          </div>
        </div>
      )}
      <div className={cn('space-y-2 min-w-0', isUser ? 'max-w-[75%]' : 'flex-1 max-w-[90%]')}>
        {hasContent && (
          <div
            className={cn(
              'rounded-xl px-4 py-2.5 text-sm leading-relaxed',
              isUser
                ? 'bg-blue-600 text-white'
                : isSystem
                  ? 'bg-zinc-800/40 border border-zinc-700/30 text-zinc-400 text-xs italic'
                  : 'bg-zinc-800/80 border border-zinc-700/40 text-zinc-100'
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap m-0">{content}</p>
            ) : (
              <div className="relative">
                <MarkdownRenderer content={content} />
                {isStreaming && !isSystem && (
                  <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        )}
        {!isUser && !isSystem && hasToolCalls && (
          <div className="space-y-1.5 ml-1">
            {toolCalls!.map((tc, i) => (
              <ToolCallDisplay
                key={tc.toolCallId || i}
                toolName={tc.toolName}
                input={tc.input}
                output={tc.result}
                status={tc.status}
                stepNumber={tc.stepNumber}
                durationMs={tc.durationMs}
                compact
              />
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 mt-1">
          <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <User className="h-4 w-4 text-white" />
          </div>
        </div>
      )}
    </div>
  );
}
