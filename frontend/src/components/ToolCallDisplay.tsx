import { Loader2, Wrench, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

interface Props {
  toolName: string;
  input: unknown;
  output?: unknown;
  status?: 'running' | 'completed' | 'error';
  stepNumber?: number;
  durationMs?: number;
  compact?: boolean;
}

const toolIcons: Record<string, string> = {
  writeFile: 'pencil',
  readFile: 'eye',
  listFiles: 'folder-open',
  deleteFile: 'trash-2',
  runCommand: 'terminal',
  executeCode: 'code',
  searchFiles: 'search',
  webFetch: 'globe',
  installPackage: 'package',
};

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  return JSON.stringify(output, null, 2);
}

export default function ToolCallDisplay({ toolName, input, output, status = 'completed', stepNumber, durationMs, compact }: Props) {
  const [expanded, setExpanded] = useState(!compact);

  const statusIcon = status === 'running' ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  ) : status === 'completed' ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-red-400" />
  );

  const statusBorder = status === 'running'
    ? 'border-blue-500/30 bg-blue-500/5'
    : status === 'completed'
    ? 'border-emerald-500/20 bg-emerald-500/5'
    : 'border-red-500/20 bg-red-500/5';

  const hasOutput = output !== undefined && output !== null && formatOutput(output).length > 0;

  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm transition-all duration-200', statusBorder)}>
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
        )}
        <Wrench className="h-3 w-3 text-zinc-500 shrink-0" />
        <span className="font-mono text-xs text-blue-400 truncate">{toolName}</span>
        {statusIcon}
        {stepNumber != null && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-auto mr-1">
            Step {stepNumber}
          </Badge>
        )}
        {durationMs != null && (
          <span className="text-[10px] text-zinc-500 ml-auto">{durationMs}ms</span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5 animate-in">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Input</span>
            <pre className="mt-1 rounded bg-zinc-800/80 p-2 text-xs text-zinc-300 overflow-x-auto max-h-40 overflow-y-auto font-mono">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {hasOutput && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Output</span>
              <pre className="mt-1 rounded bg-zinc-800/80 p-2 text-xs text-zinc-300 overflow-x-auto max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                {formatOutput(output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
