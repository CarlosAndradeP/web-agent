import { Progress } from './ui/progress';
import { cn } from '../lib/utils';

interface Props {
  currentStep: number;
  totalSteps: number;
  isStreaming: boolean;
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

export default function StepProgressBar({ currentStep, totalSteps, isStreaming, currentToolName }: Props) {
  if (!isStreaming && currentStep === 0) return null;

  const pct = totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;
  const description = currentToolName ? (toolDescriptions[currentToolName] || `Usando ${currentToolName}...`) : null;

  return (
    <div className="px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 max-w-3xl mx-auto">
        {isStreaming && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Trabalhando</span>
          </div>
        )}
        {!isStreaming && currentStep > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Concluído</span>
          </div>
        )}
        <div className="flex-1">
          <Progress value={pct} className="h-0.5" />
        </div>
        <span className="text-[11px] text-zinc-600 tabular-nums shrink-0">
          {currentStep}/{totalSteps}
        </span>
      </div>
      {description && isStreaming && (
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
