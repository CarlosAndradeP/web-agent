import type { AgentStep } from '../types';
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  steps: AgentStep[];
}

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  needs_approval: AlertTriangle,
};

const statusColors: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  needs_approval: 'text-yellow-400',
};

export default function ProgressLog({ steps }: Props) {
  if (steps.length === 0) {
    return <p className="text-xs text-zinc-600">No steps recorded yet</p>;
  }

  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const Icon = statusIcons[step.status] || CheckCircle2;
        const color = statusColors[step.status] || 'text-zinc-400';
        return (
          <div key={step.id} className={cn('flex items-center gap-2 text-xs py-1 animate-in', i === steps.length - 1 && step.status === 'running' && 'animate-pulse')}>
            <span className="text-[10px] text-zinc-600 w-5 text-right tabular-nums">{step.stepNumber}</span>
            <Icon className={cn('h-3 w-3 shrink-0', color)} />
            <span className={cn('font-mono truncate', color)}>
              {step.toolName || 'thinking'}
            </span>
            {step.durationMs != null && (
              <span className="text-[10px] text-zinc-600 ml-auto tabular-nums">{step.durationMs}ms</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
