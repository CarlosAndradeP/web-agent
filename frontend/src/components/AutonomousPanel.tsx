import { useEffect, useState } from 'react';
import { useOrchestrator } from '../hooks/useOrchestrator';
import OrchestratorHeader from './OrchestratorHeader';
import OrchestratorLog from './OrchestratorLog';
import OrchestratorControls from './OrchestratorControls';
import OrchestratorTasks from './OrchestratorTasks';
import { ListTodo, Activity, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

type Tab = 'plan' | 'activity';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

export default function AutonomousPanel({ sessionId }: { sessionId: string }) {
  const { status, steps, tasks, logs, isLoading, start, stop, pause, resume, uploadMd, refresh } = useOrchestrator(sessionId);
  const [tab, setTab] = useState<Tab>('plan');
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    refresh();
  }, []);

  const addToast = (type: Toast['type'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const sessionStatus = status?.session?.status;
  const [prevStatus, setPrevStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!sessionStatus || sessionStatus === prevStatus) return;
    if (prevStatus !== undefined) {
      if (sessionStatus === 'completed') addToast('success', 'Build do projeto concluído com sucesso.');
      else if (sessionStatus === 'failed') addToast('error', 'Build do projeto falhou. Veja os detalhes no log de atividade.');
      else if (sessionStatus === 'paused') addToast('info', 'Orquestrador pausado.');
      else if (sessionStatus === 'running' && prevStatus === 'paused') addToast('info', 'Orquestrador retomado.');
    }
    setPrevStatus(sessionStatus);
  }, [sessionStatus, prevStatus]);

  const [prevTaskCount, setPrevTaskCount] = useState(0);
  useEffect(() => {
    if (tasks.length > prevTaskCount && prevTaskCount === 0) {
      setTab('plan');
    }
    setPrevTaskCount(tasks.length);
  }, [tasks.length, prevTaskCount]);

  const isRunning = status?.isRunning ?? false;
  const runningTaskCount = tasks.filter(t => t.status === 'running').length;

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <OrchestratorHeader status={status} isLoading={isLoading} />

      <div className="flex items-center gap-1 px-3 pt-2 border-b border-zinc-800/60 shrink-0">
        <button
          onClick={() => setTab('plan')}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded-t',
            tab === 'plan' ? 'text-zinc-100 bg-zinc-900/50' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <ListTodo className="h-3.5 w-3.5" />
          Plano
          {tasks.length > 0 && (
            <span className="text-[10px] text-zinc-600 font-mono">{tasks.length}</span>
          )}
          {runningTaskCount > 0 && (
            <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setTab('activity')}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded-t',
            tab === 'activity' ? 'text-zinc-100 bg-zinc-900/50' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Atividade
          {isRunning && (
            <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'plan' ? (
          <OrchestratorTasks tasks={tasks} isRunning={isRunning} />
        ) : (
          <OrchestratorLog steps={steps} logs={logs} />
        )}
      </div>

      <OrchestratorControls
        status={status}
        isLoading={isLoading}
        onStart={start}
        onStop={stop}
        onPause={pause}
        onResume={resume}
        onUploadMd={uploadMd}
      />

      {toasts.length > 0 && (
        <div className="absolute bottom-24 right-4 z-20 space-y-2 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-lg border text-xs shadow-lg max-w-xs animate-in fade-in slide-in-from-bottom-2',
                t.type === 'success' && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
                t.type === 'error' && 'bg-red-500/10 border-red-500/30 text-red-200',
                t.type === 'info' && 'bg-zinc-800 border-zinc-700 text-zinc-200'
              )}
            >
              {t.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
              {t.type === 'error' && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="opacity-60 hover:opacity-100 shrink-0 mt-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
