import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import type { ApprovalRequest } from '../types';
import { Pencil, Terminal, Trash2, Package, Code, Eye, FolderOpen, Search, Globe, Users, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

const toolActionMap: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  writeFile: { label: 'Escrever arquivo', icon: Pencil },
  readFile: { label: 'Ler arquivo', icon: Eye },
  listFiles: { label: 'Listar diretório', icon: FolderOpen },
  deleteFile: { label: 'Apagar arquivo', icon: Trash2 },
  runCommand: { label: 'Executar comando', icon: Terminal },
  executeCode: { label: 'Executar código', icon: Code },
  searchFiles: { label: 'Buscar arquivos', icon: Search },
  webFetch: { label: 'Acessar URL', icon: Globe },
  installPackage: { label: 'Instalar pacote', icon: Package },
  invokeSubAgent: { label: 'Delegar sub-tarefa', icon: Users },
};

function getSummary(toolName: string, input: unknown): string {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  switch (toolName) {
    case 'writeFile':
      return String(obj.path || obj.filePath || 'arquivo');
    case 'readFile':
      return String(obj.path || obj.filePath || 'arquivo');
    case 'deleteFile':
      return String(obj.path || obj.filePath || 'arquivo/pasta');
    case 'runCommand':
      return String(obj.command || 'comando');
    case 'executeCode':
      return String(obj.language || 'código');
    case 'searchFiles':
      return String(obj.pattern || obj.query || 'busca');
    case 'webFetch':
      return String(obj.url || 'URL');
    case 'installPackage':
      return String(obj.package || obj.name || 'pacote');
    case 'listFiles':
      return String(obj.path || obj.dirPath || 'diretório');
    case 'invokeSubAgent':
      return String(obj.task || obj.description || 'sub-tarefa');
    default:
      return String((obj as any).path || (obj as any).command || (obj as any).url || '');
  }
}

interface Props {
  request: ApprovalRequest;
  onRespond: (approved: boolean) => void;
}

export default function ApprovalDialog({ request, onRespond }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const action = toolActionMap[request.toolName] || { label: request.toolName, icon: Terminal };
  const ActionIcon = action.icon;
  const summary = getSummary(request.toolName, request.toolInput);

  return (
    <Dialog open onOpenChange={() => onRespond(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-400" />
            Aprovação necessária
          </DialogTitle>
          <DialogDescription>O agente deseja executar uma ação que requer aprovação</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-zinc-800 rounded-md px-3 py-3">
            <ActionIcon className="h-5 w-5 text-blue-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-100">{action.label}</div>
              <div className="text-xs text-zinc-400 truncate mt-0.5">{summary}</div>
            </div>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showDetails ? 'Ocultar detalhes' : 'Ver detalhes'}
          </button>
          {showDetails && (
            <pre className="bg-zinc-800 rounded-md p-3 text-xs text-zinc-400 overflow-x-auto max-h-32 overflow-y-auto font-mono">
              {JSON.stringify(request.toolInput, null, 2)}
            </pre>
          )}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => onRespond(false)}>Rejeitar</Button>
          <Button onClick={() => onRespond(true)} className="bg-emerald-600 hover:bg-emerald-700">Aprovar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
