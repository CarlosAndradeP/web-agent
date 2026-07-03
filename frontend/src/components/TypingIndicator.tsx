import { cn } from '../lib/utils';

interface Props {
  toolName?: string | null;
}

const toolMessages: Record<string, string> = {
  writeFile: 'Escrevendo arquivo...',
  readFile: 'Lendo arquivo...',
  listFiles: 'Explorando workspace...',
  deleteFile: 'Excluindo arquivo...',
  runCommand: 'Executando comando...',
  executeCode: 'Executando código...',
  searchFiles: 'Pesquisando no código...',
  webFetch: 'Buscando conteúdo web...',
  installPackage: 'Instalando dependências...',
  invokeSubAgent: 'Executando subagente...',
};

export default function TypingIndicator({ toolName }: Props) {
  const message = toolName ? (toolMessages[toolName] || `Usando ${toolName}...`) : 'Agente pensando...';

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
      </div>
      <span className={cn(
        'text-xs transition-all',
        toolName === 'runCommand' ? 'text-amber-400' :
        toolName === 'writeFile' ? 'text-blue-400' :
        toolName === 'installPackage' ? 'text-purple-400' :
        toolName === 'invokeSubAgent' ? 'text-indigo-400' :
        'text-zinc-600'
      )}>
        {message}
      </span>
    </div>
  );
}
