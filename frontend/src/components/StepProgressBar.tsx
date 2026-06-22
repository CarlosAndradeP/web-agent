import { Progress } from './ui/progress';

interface Props {
  currentStep: number;
  totalSteps: number;
  isStreaming: boolean;
}

export default function StepProgressBar({ currentStep, totalSteps, isStreaming }: Props) {
  if (!isStreaming && currentStep === 0) return null;

  const pct = totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;

  return (
    <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-3">
        {isStreaming && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Working</span>
          </div>
        )}
        <div className="flex-1">
          <Progress value={pct} className="h-1" />
        </div>
        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {currentStep}/{totalSteps} steps
        </span>
      </div>
    </div>
  );
}
