import { useEffect, useState } from 'react';
import type { OrchestratorStatusInfo } from '../types';
import { BrainCircuit, Clock, Activity, CheckCircle2, AlertCircle, Pause } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  status: OrchestratorStatusInfo | null;
  isLoading: boolean;
}

type Phase = 'plan' | 'execute' | 'verify';

function derivePhase(progress: number, currentStep: string | null | undefined, status: string | undefined): Phase {
  if (status === 'completed') return 'verify';
  if (currentStep) {
    const lower = currentStep.toLowerCase();
    if (lower.includes('plan created') || lower.includes('plan')) return 'execute';
    if (lower.includes('verif')) return 'verify';
  }
  if (progress >= 90) return 'verify';
  if (progress > 0) return 'execute';
  return 'plan';
}

const PHASES: { key: Phase; label: string; icon: any }[] = [
  { key: 'plan', label: 'Planejar', icon: BrainCircuit },
  { key: 'execute', label: 'Executar', icon: Activity },
  { key: 'verify', label: 'Verificar', icon: CheckCircle2 },
];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

export default function OrchestratorHeader({ status, isLoading }: Props) {
  const isRunning = status?.isRunning ?? false;
  const session = status?.session;
  const sessionStatus = session?.status ?? 'idle';
  const progressPercent = session?.progressPercent ?? 0;
  const errorCount = session?.errorCount ?? 0;
  const totalSteps = status?.totalStepsCompleted ?? 0;
  const currentStep = session?.currentStep ?? null;

  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isRunning && startTime === null) {
      setStartTime(Date.now());
    } else if (!isRunning && startTime !== null) {
      setStartTime(null);
      setElapsed(0);
    }
  }, [isRunning, startTime]);

  useEffect(() => {
    if (!isRunning || startTime === null) return;
    const id = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(id);
  }, [isRunning, startTime]);

  const phase = derivePhase(progressPercent, currentStep, sessionStatus);
  const statusBadge = (() => {
    switch (sessionStatus) {
      case 'running':
        return { label: 'Em execução', icon: Activity, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' };
      case 'paused':
        return { label: 'Pausado', icon: Pause, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' };
      case 'completed':
        return { label: 'Concluído', icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' };
      case 'failed':
        return { label: 'Falhou', icon: AlertCircle, color: 'text-red-400 bg-red-400/10 border-red-400/20' };
      default:
        return null;
    }
  })();

  return (
    <div className="px-4 py-3 border-b border-zinc-800/60 space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0">
          <BrainCircuit className={cn('h-4 w-4 text-blue-400', isRunning && 'animate-pulse')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-zinc-100">Agente autônomo</span>
            <span className="text-[10px] text-zinc-500 font-mono">moonshotai/kimi-k3</span>
            {statusBadge && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border',
                statusBadge.color
              )}>
                <statusBadge.icon className={cn('h-2.5 w-2.5', isRunning && 'animate-pulse')} />
                {statusBadge.label}
              </span>
            )}
            {isLoading && <span className="text-[10px] text-zinc-600">sincronizando...</span>}
          </div>
          {session ? (
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[11px] text-zinc-500 truncate max-w-[280px]">{session.objective || 'Nenhum objetivo definido'}</span>
              <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
                <span className="flex items-center gap-0.5">
                  <Activity className="h-2.5 w-2.5" />
                  {totalSteps} etapas
                </span>
                {errorCount > 0 && (
                  <span className="flex items-center gap-0.5 text-amber-400">
                    <AlertCircle className="h-2.5 w-2.5" />
                    {errorCount} erro(s)
                  </span>
                )}
                {isRunning && startTime !== null && (
                  <span className="flex items-center gap-0.5 text-blue-400">
                    <Clock className="h-2.5 w-2.5" />
                    {formatElapsed(elapsed)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-600 mt-0.5">Builder autônomo multiagente · Planejar → Executar → Verificar</p>
          )}
        </div>
        {progressPercent > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  sessionStatus === 'failed' ? 'bg-red-500' : 'bg-blue-500'
                )}
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">{progressPercent}%</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {PHASES.map((p, i) => {
          const Icon = p.icon;
          const isCompleted = PHASES.findIndex(ph => ph.key === phase) > i || sessionStatus === 'completed';
          const isActive = phase === p.key && isRunning;
          return (
            <div key={p.key} className="flex items-center gap-1.5 flex-1">
              <div className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-medium transition-colors',
                isActive && 'bg-blue-500/10 border-blue-500/40 text-blue-300',
                isCompleted && !isActive && 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/70',
                !isActive && !isCompleted && 'border-zinc-800 text-zinc-600'
              )}>
                <Icon className={cn('h-3 w-3', isActive && 'animate-pulse')} />
                {p.label}
              </div>
              {i < PHASES.length - 1 && (
                <div className={cn('h-px flex-1 min-w-2', isCompleted ? 'bg-emerald-500/30' : 'bg-zinc-800')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
