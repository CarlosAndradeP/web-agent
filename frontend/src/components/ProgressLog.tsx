import type { AgentStep } from '../types';

interface Props {
  steps: AgentStep[];
}

const statusColors: Record<string, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  needs_approval: 'text-yellow-400',
};

export default function ProgressLog({ steps }: Props) {
  return (
    <div className="space-y-1 text-sm font-mono">
      {steps.map(step => (
        <div key={step.id} className="flex gap-2 items-start">
          <span className="text-gray-500 w-6 text-right">{step.stepNumber}</span>
          <span className={statusColors[step.status] ?? 'text-gray-300'}>
            {step.toolName ?? 'thinking'}
          </span>
          {step.durationMs != null && (
            <span className="text-gray-600 text-xs">{step.durationMs}ms</span>
          )}
        </div>
      ))}
    </div>
  );
}
