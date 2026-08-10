import { Progress } from './ui/progress';
import { cn } from '../lib/utils';
import type { ChatStatus } from '../hooks/useChat';

interface Props {
  currentStep: number;
  totalSteps: number;
  status: ChatStatus;
  currentToolName?: string | null;
}

const toolDescriptions: Record<string, string> = {
  writeFile: 'Escrevendo arquivo...',
  readFile: 'Lendo arquivo...',
  listFiles: 'Listando arquivos...',
  deleteFile: 'Excluindo arquivo...',
  runCommand: 'Executando comando...',
  executeCode: 'Executando código...',
  searchFiles: 'Pesquisando arquivos...',
  webFetch: 'Buscando URL...',
  installPackage: 'Instalando pacote...',
  invokeSubAgent: 'Executando subagente...',
};

export default function StepProgressBar({ currentStep, totalSteps, status, currentToolName }: Props) {
  if (status === 'idle') return null;

  const pct = totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;
  const description = currentToolName ? (toolDescriptions[currentToolName] || `Usando ${currentToolName}...`) : null;
  const active = status === 'connecting' || status === 'running' || status === 'awaiting_approval' || status === 'cancelling';
  const labels: Record<Exclude<ChatStatus, 'idle'>, string> = {
    connecting: 'Preparando',
    running: 'Executando',
    awaiting_approval: 'Aguardando aprovação',
    completed: 'Concluído',
    cancelling: 'Interrompendo',
    cancelled: 'Interrompido',
    error: 'Falhou',
  };
  const dotColor = status === 'completed' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : status === 'cancelled' || status === 'cancelling' || status === 'awaiting_approval' ? 'bg-amber-400' : 'bg-blue-400';

  return (
    <div className="shrink-0 px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 shrink-0">
          <div className={cn('h-2 w-2 rounded-full', dotColor, active && 'animate-pulse')} />
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{labels[status]}</span>
        </div>
        <div className="flex-1">
          <Progress value={pct} className="h-0.5" />
        </div>
        <span className="text-[11px] text-zinc-600 tabular-nums shrink-0">
          {currentStep}/{totalSteps || '—'}
        </span>
      </div>
      {description && active && (
        <div className="mt-1 flex items-center gap-1.5 max-w-3xl mx-auto">
          <span className={cn(
            'text-[10px] font-medium tracking-wide',
            currentToolName === 'runCommand' ? 'text-amber-400' :
            currentToolName === 'writeFile' ? 'text-blue-400' :
            currentToolName === 'installPackage' ? 'text-purple-400' :
            currentToolName === 'invokeSubAgent' ? 'text-indigo-400' :
            'text-zinc-500'
          )}>
            {description}
          </span>
        </div>
      )}
    </div>
  );
}
