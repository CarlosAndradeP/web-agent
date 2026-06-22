import { useState, useEffect } from 'react';
import { useTasks } from '../hooks/useTasks';
import { api } from '../lib/api';
import type { Task, AgentStep } from '../types';
import ProgressLog from './ProgressLog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { ListTodo, Circle, CheckCircle2, XCircle, Clock, Ban } from 'lucide-react';
import { cn } from '../lib/utils';

const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; badge: 'default' | 'secondary' | 'destructive' | 'success' | 'outline' }> = {
  pending: { icon: Clock, color: 'text-zinc-400', badge: 'secondary' },
  running: { icon: Circle, color: 'text-blue-400', badge: 'default' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400', badge: 'success' },
  failed: { icon: XCircle, color: 'text-red-400', badge: 'destructive' },
  cancelled: { icon: Ban, color: 'text-yellow-400', badge: 'outline' },
};

export default function TaskManager() {
  const { tasks, loading, refresh } = useTasks();
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);

  const toggleExpand = async (taskId: string) => {
    if (expandedTask === taskId) {
      setExpandedTask(null);
      return;
    }
    setExpandedTask(taskId);
    const data = await api.tasks.steps(taskId);
    setSteps(data.steps);
  };

  if (loading) return <div className="p-4 text-zinc-500">Loading tasks...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Tasks</h2>
          <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {tasks.length === 0 && (
            <div className="py-16 text-center">
              <ListTodo className="h-10 w-10 mx-auto mb-2 text-zinc-700" />
              <p className="text-sm text-zinc-600">No tasks yet</p>
              <p className="text-xs text-zinc-700 mt-1">Tasks are created when you send a message in Chat</p>
            </div>
          )}
          {tasks.map(task => {
            const cfg = statusConfig[task.status] || statusConfig.pending;
            const Icon = cfg.icon;
            return (
              <div key={task.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleExpand(task.id)}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', cfg.color, task.status === 'running' && 'animate-pulse')} />
                  <span className="text-xs text-zinc-300 truncate flex-1">{task.description}</span>
                  <Badge variant={cfg.badge} className="text-[10px] shrink-0">{task.status}</Badge>
                </div>
                {task.status === 'running' && (
                  <div className="px-3 pb-2">
                    <Button variant="ghost" size="sm" onClick={() => api.tasks.cancel(task.id).then(refresh)} className="h-6 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10">
                      Cancel
                    </Button>
                  </div>
                )}
                {expandedTask === task.id && (
                  <div className="border-t border-zinc-800 p-3 animate-in">
                    <ProgressLog steps={steps} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
