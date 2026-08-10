import type { ToolCallInfo } from '../hooks/useChat';
import ToolCallDisplay from './ToolCallDisplay';
import MarkdownRenderer from './MarkdownRenderer';
import GeneratedFilesCard from './GeneratedFilesCard';
import { Bot, User, Info } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
  createdFiles?: string[];
  createdFileCount?: number;
  basePath?: string;
}

export default function MessageBubble({ role, content, toolCalls, isStreaming, createdFiles, createdFileCount, basePath }: Props) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasContent = content.trim().length > 0;

  return (
    <article className={cn('flex gap-2.5 sm:gap-3 animate-in', isUser ? 'justify-end' : 'justify-start')} aria-label={isUser ? 'Sua mensagem' : isSystem ? 'Mensagem do sistema' : 'Resposta do agente'}>
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
      <div className={cn('space-y-2 min-w-0', isUser ? 'max-w-[88%] sm:max-w-[75%]' : 'flex-1 max-w-[92%]')}>
        {hasContent && (
          <div
            className={cn(
               'rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
              isUser
                 ? 'bg-blue-600 text-white rounded-tr-md'
                : isSystem
                  ? 'bg-zinc-800/40 border border-zinc-700/30 text-zinc-400 text-xs italic'
                   : 'bg-zinc-900/80 border border-zinc-800 text-zinc-100 rounded-tl-md'
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
        {!isUser && !isSystem && createdFiles && createdFiles.length > 0 && (
          <GeneratedFilesCard files={createdFiles} totalCount={createdFileCount} basePath={basePath} />
        )}
      </div>
      {isUser && (
        <div className="shrink-0 mt-1">
          <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <User className="h-4 w-4 text-white" />
          </div>
        </div>
      )}
    </article>
  );
}
