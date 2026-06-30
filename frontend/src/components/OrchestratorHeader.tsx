import type { OrchestratorStatusInfo } from '../types';
import { BrainCircuit } from 'lucide-react';

interface Props {
  status: OrchestratorStatusInfo | null;
  isLoading: boolean;
}

export default function OrchestratorHeader({ status, isLoading }: Props) {
  const isRunning = status?.isRunning ?? false;
  const session = status?.session;
  const progressPercent = session?.progressPercent ?? 0;
  const errorCount = session?.errorCount ?? 0;

  return (
    <div className="px-4 py-3 border-b border-zinc-800/60">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0">
          <BrainCircuit className="h-4 w-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">Autonomous Agent</span>
            <span className="text-[10px] text-zinc-500 font-mono">kimi-k2.6</span>
            <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
          </div>
          {session && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[11px] text-zinc-500 truncate max-w-[300px]">{session.objective}</span>
              {errorCount > 0 && (
                <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded font-mono">{errorCount} err</span>
              )}
            </div>
          )}
        </div>
        {progressPercent > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">{progressPercent}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
