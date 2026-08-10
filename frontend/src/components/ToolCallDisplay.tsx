import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Pencil, Eye, FolderOpen, Trash2, Terminal, Code, Search, Globe, Package, Users } from 'lucide-react';
import { useId, useState } from 'react';
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

const toolIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  writeFile: Pencil,
  readFile: Eye,
  listFiles: FolderOpen,
  deleteFile: Trash2,
  runCommand: Terminal,
  executeCode: Code,
  searchFiles: Search,
  webFetch: Globe,
  installPackage: Package,
  invokeSubAgent: Users,
};

const toolColorMap: Record<string, string> = {
  writeFile: 'text-blue-400',
  readFile: 'text-cyan-400',
  listFiles: 'text-amber-400',
  deleteFile: 'text-red-400',
  runCommand: 'text-amber-400',
  executeCode: 'text-purple-400',
  searchFiles: 'text-green-400',
  webFetch: 'text-sky-400',
  installPackage: 'text-pink-400',
  invokeSubAgent: 'text-indigo-400',
};

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  return JSON.stringify(output, null, 2);
}

export default function ToolCallDisplay({ toolName, input, output, status = 'completed', stepNumber, durationMs, compact }: Props) {
  const [expanded, setExpanded] = useState(!compact);
  const detailsId = useId();

  const statusIcon = status === 'running' ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  ) : status === 'completed' ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-red-400" />
  );

  const statusBorder = status === 'running'
    ? 'border-blue-500/20 bg-blue-500/5'
    : status === 'completed'
    ? 'border-zinc-700/40 bg-zinc-800/30'
    : 'border-red-500/20 bg-red-500/5';

  const hasOutput = output !== undefined && output !== null && formatOutput(output).length > 0;
  const ToolIcon = toolIconMap[toolName];
  const toolColor = toolColorMap[toolName] || 'text-zinc-400';
  const statusLabel = status === 'running' ? 'executando' : status === 'completed' ? 'concluído' : 'falhou';

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm transition-all duration-200', statusBorder)}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
        )}
        {ToolIcon ? (
          <ToolIcon className={cn('h-3 w-3 shrink-0', toolColor)} />
        ) : (
          <Terminal className="h-3 w-3 text-zinc-400 shrink-0" />
        )}
        <span className="font-mono text-[11px] text-zinc-400 truncate">{toolName}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {statusIcon}
          <span className="sr-only">{statusLabel}</span>
          {stepNumber != null && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{stepNumber}</Badge>
          )}
          {durationMs != null && (
            <span className="text-[10px] text-zinc-600 tabular-nums">{durationMs}ms</span>
          )}
        </div>
      </button>

      {expanded && (
        <div id={detailsId} className="mt-2 space-y-1.5 animate-in">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Entrada</span>
            <pre className="mt-1 rounded-lg bg-zinc-900/80 border border-zinc-800/40 p-2 text-xs text-zinc-400 overflow-x-auto max-h-40 overflow-y-auto font-mono">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {hasOutput && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Saída</span>
              <pre className="mt-1 rounded-lg bg-zinc-900/80 border border-zinc-800/40 p-2 text-xs text-zinc-400 overflow-x-auto max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                {formatOutput(output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
