import { cn } from '../lib/utils';

interface Props {
  toolName?: string | null;
}

const toolMessages: Record<string, string> = {
  writeFile: 'Writing file...',
  readFile: 'Reading file...',
  listFiles: 'Exploring workspace...',
  deleteFile: 'Deleting file...',
  runCommand: 'Running command...',
  executeCode: 'Executing code...',
  searchFiles: 'Searching codebase...',
  webFetch: 'Fetching web content...',
  installPackage: 'Installing dependencies...',
  invokeSubAgent: 'Running sub-agent...',
};

export default function TypingIndicator({ toolName }: Props) {
  const message = toolName ? (toolMessages[toolName] || `Using ${toolName}...`) : 'Agent thinking...';

  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
      </div>
      <span className={cn(
        'text-xs ml-1 transition-all',
        toolName === 'runCommand' ? 'text-amber-400' :
        toolName === 'writeFile' ? 'text-blue-400' :
        toolName === 'installPackage' ? 'text-purple-400' :
        toolName === 'invokeSubAgent' ? 'text-indigo-400' :
        'text-zinc-500'
      )}>
        {message}
      </span>
    </div>
  );
}
