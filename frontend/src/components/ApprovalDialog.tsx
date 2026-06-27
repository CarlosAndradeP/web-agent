import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import type { ApprovalRequest } from '../types';
import { Pencil, Terminal, Trash2, Package, Code, Eye, FolderOpen, Search, Globe, Users, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

const toolActionMap: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  writeFile: { label: 'Write file', icon: Pencil },
  readFile: { label: 'Read file', icon: Eye },
  listFiles: { label: 'List directory', icon: FolderOpen },
  deleteFile: { label: 'Delete file', icon: Trash2 },
  runCommand: { label: 'Run command', icon: Terminal },
  executeCode: { label: 'Execute code', icon: Code },
  searchFiles: { label: 'Search files', icon: Search },
  webFetch: { label: 'Fetch URL', icon: Globe },
  installPackage: { label: 'Install package', icon: Package },
  invokeSubAgent: { label: 'Delegate sub-task', icon: Users },
};

function getSummary(toolName: string, input: unknown): string {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  switch (toolName) {
    case 'writeFile':
      return String(obj.path || obj.filePath || 'file');
    case 'readFile':
      return String(obj.path || obj.filePath || 'file');
    case 'deleteFile':
      return String(obj.path || obj.filePath || 'file/folder');
    case 'runCommand':
      return String(obj.command || 'command');
    case 'executeCode':
      return String(obj.language || 'code');
    case 'searchFiles':
      return String(obj.pattern || obj.query || 'search');
    case 'webFetch':
      return String(obj.url || 'URL');
    case 'installPackage':
      return String(obj.package || obj.name || 'package');
    case 'listFiles':
      return String(obj.path || obj.dirPath || 'directory');
    case 'invokeSubAgent':
      return String(obj.task || obj.description || 'sub-task');
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
            Approval required
          </DialogTitle>
          <DialogDescription>The agent wants to perform an action that requires approval</DialogDescription>
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
            {showDetails ? 'Hide details' : 'View details'}
          </button>
          {showDetails && (
            <pre className="bg-zinc-800 rounded-md p-3 text-xs text-zinc-400 overflow-x-auto max-h-32 overflow-y-auto font-mono">
              {JSON.stringify(request.toolInput, null, 2)}
            </pre>
          )}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => onRespond(false)}>Reject</Button>
          <Button onClick={() => onRespond(true)} className="bg-emerald-600 hover:bg-emerald-700">Approve</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
