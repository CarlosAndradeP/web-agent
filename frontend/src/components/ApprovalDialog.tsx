import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import type { ApprovalRequest } from '../types';
import { Wrench, ShieldAlert } from 'lucide-react';

interface Props {
  request: ApprovalRequest;
  onRespond: (approved: boolean) => void;
}

export default function ApprovalDialog({ request, onRespond }: Props) {
  return (
    <Dialog open onOpenChange={() => onRespond(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-400" />
            Approval Required
          </DialogTitle>
          <DialogDescription>The agent wants to execute a tool that requires your approval</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-zinc-800 rounded-md px-3 py-2">
            <Wrench className="h-4 w-4 text-blue-400 shrink-0" />
            <span className="font-mono text-sm text-blue-400">{request.toolName}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Input</span>
            <pre className="mt-1 bg-zinc-800 rounded-md p-3 text-xs text-zinc-300 overflow-x-auto max-h-40 overflow-y-auto">
              {JSON.stringify(request.toolInput, null, 2)}
            </pre>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => onRespond(false)}>Reject</Button>
          <Button onClick={() => onRespond(true)} className="bg-emerald-600 hover:bg-emerald-700">Approve</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
