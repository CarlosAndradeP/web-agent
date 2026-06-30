import { useState } from 'react';
import type { OrchestratorStepInfo } from '../types';
import type { LogEntry } from '../hooks/useOrchestrator';
import { ChevronDown, ChevronRight, Clock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  steps: OrchestratorStepInfo[];
  logs: LogEntry[];
}

const ROLE_COLORS: Record<string, string> = {
  orchestrator: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  auxiliar: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  arquiteto: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  programador: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
};

const ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  auxiliar: 'Auxiliar',
  arquiteto: 'Arquiteto',
  programador: 'Programador',
};

function StepEntry({ step }: { step: OrchestratorStepInfo }) {
  const [expanded, setExpanded] = useState(false);
  const color = ROLE_COLORS[step.role] ?? ROLE_COLORS.orchestrator;

  return (
    <div className="px-3 py-2 border-b border-zinc-800/40">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="h-3 w-3 text-zinc-600 shrink-0" /> : <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />}
        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', color)}>
          {ROLE_LABELS[step.role] ?? step.role}
        </span>
        <span className="text-[11px] text-zinc-400 truncate flex-1">{step.action}: {step.input?.slice(0, 60)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {step.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
          {step.status === 'running' && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
          {step.status === 'failed' && <AlertCircle className="h-3 w-3 text-red-400" />}
          {step.status === 'pending' && <Clock className="h-3 w-3 text-zinc-600" />}
          {step.durationMs != null && (
            <span className="text-[9px] text-zinc-600 font-mono">{(step.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-5 space-y-1.5">
          <div>
            <span className="text-[10px] text-zinc-600 font-medium uppercase">Input</span>
            <pre className="text-[11px] text-zinc-400 bg-zinc-900 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.input}</pre>
          </div>
          {step.output && (
            <div>
              <span className="text-[10px] text-zinc-600 font-medium uppercase">Output</span>
              <pre className="text-[11px] text-zinc-400 bg-zinc-900 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.output}</pre>
            </div>
          )}
          {step.errorMessage && (
            <div>
              <span className="text-[10px] text-red-500 font-medium uppercase">Error</span>
              <pre className="text-[11px] text-red-400 bg-red-400/5 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.errorMessage}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const color = ROLE_COLORS[entry.role] ?? ROLE_COLORS.orchestrator;
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className={cn('font-medium shrink-0', color.split(' ')[0])}>{ROLE_LABELS[entry.role] ?? entry.role}</span>
      <span className="text-zinc-500 truncate flex-1">{entry.message}</span>
      <span className="text-[9px] text-zinc-700 font-mono shrink-0">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

export default function OrchestratorLog({ steps, logs }: Props) {
  const allEntries = [
    ...steps.map(s => ({ type: 'step' as const, data: s })),
    ...logs.map(l => ({ type: 'log' as const, data: l })),
  ].sort((a, b) => {
    const timeA = a.type === 'step' ? a.data.createdAt : a.data.timestamp;
    const timeB = b.type === 'step' ? b.data.createdAt : b.data.timestamp;
    return new Date(timeA).getTime() - new Date(timeB).getTime();
  });

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {allEntries.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-2">
            <div className="h-10 w-10 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mx-auto">
              <span className="text-lg text-zinc-600">~</span>
            </div>
            <p className="text-xs text-zinc-600">No activity yet</p>
            <p className="text-[11px] text-zinc-700">Start the orchestrator to begin</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/30">
          {allEntries.map((entry, i) =>
            entry.type === 'step'
              ? <StepEntry key={`step-${i}`} step={entry.data} />
              : <LogEntryRow key={`log-${i}`} entry={entry.data} />
          )}
        </div>
      )}
    </div>
  );
}
