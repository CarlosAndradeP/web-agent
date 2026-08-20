import { useState } from 'react';
import type { OrchestratorTaskInfo } from '../types';
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2, Clock, Link2, FileCode, Code, Eye, Shield, BrainCircuit, MinusCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  tasks: OrchestratorTaskInfo[];
  isRunning: boolean;
}

const ROLE_META: Record<string, { label: string; icon: any; color: string }> = {
  orchestrator: { label: 'Orchestrator', icon: BrainCircuit, color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  auxiliar: { label: 'Auxiliar', icon: Shield, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  arquiteto: { label: 'Arquiteto', icon: FileCode, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  programador: { label: 'Programador', icon: Code, color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  revisor: { label: 'Revisor', icon: Eye, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case 'running': return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
    case 'failed': return <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    case 'superseded': return <MinusCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    case 'pending':
    default: return <Clock className="h-3.5 w-3.5 text-zinc-600 shrink-0" />;
  }
}

function TaskCard({ task, index }: { task: OrchestratorTaskInfo; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ROLE_META[task.role] ?? ROLE_META.programador;
  const Icon = meta.icon;
  const isRunning = task.status === 'running';
  const targetMatch = task.description.match(/TARGET FILES:\s*([^\n]+)/i);
  const targetFiles = targetMatch ? targetMatch[1].split(',').map(f => f.trim()).filter(Boolean) : [];
  const acMatch = task.description.match(/ACCEPTANCE CRITERIA:\s*\n([\s\S]+?)(?:\n\n|\n---|$)/i);
  const acceptance = acMatch ? acMatch[1].split('\n').filter(l => l.trim()).map(l => l.replace(/^\d+\.\s*/, '').trim()) : [];
  const baseDesc = task.description.split(/\n\n(TARGET FILES|ACCEPTANCE CRITERIA):/)[0].trim();

  return (
    <div className={cn(
      'px-3 py-2.5 border-b border-zinc-800/40 transition-colors',
      isRunning && 'bg-blue-500/5'
    )}>
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1 pt-0.5 shrink-0">
          {expanded ? <ChevronDown className="h-3 w-3 text-zinc-600" /> : <ChevronRight className="h-3 w-3 text-zinc-600" />}
          <StatusIcon status={task.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-600 font-mono shrink-0">#{task.stepNumber || index + 1}</span>
            <span className="text-xs font-medium text-zinc-200 truncate">{task.name}</span>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border', meta.color)}>
              <Icon className="h-2.5 w-2.5" />
              {meta.label}
            </span>
            {task.dependsOn && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500" title={`Depende de: ${task.dependsOn}`}>
                <Link2 className="h-2.5 w-2.5" />
                {task.dependsOn}
              </span>
            )}
          </div>
          {!expanded && (
            <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{baseDesc}</p>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-9 space-y-2">
          <div>
              <span className="text-[10px] text-zinc-600 font-medium uppercase">Descrição</span>
            <p className="text-[11px] text-zinc-400 mt-0.5 whitespace-pre-wrap">{baseDesc}</p>
          </div>
          {targetFiles.length > 0 && (
            <div>
                <span className="text-[10px] text-zinc-600 font-medium uppercase">Arquivos alvo</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {targetFiles.map((f, i) => (
                  <code key={i} className="text-[10px] text-zinc-300 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">{f}</code>
                ))}
              </div>
            </div>
          )}
          {acceptance.length > 0 && (
            <div>
              <span className="text-[10px] text-zinc-600 font-medium uppercase">Critérios de aceite</span>
              <ul className="text-[11px] text-zinc-400 mt-0.5 space-y-0.5 list-disc list-inside">
                {acceptance.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {task.errorMessage && (
            <div>
              <span className="text-[10px] text-red-500 font-medium uppercase">Problema</span>
              <p className="text-[11px] text-red-400 bg-red-400/5 rounded p-2 mt-0.5 whitespace-pre-wrap">{task.errorMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OrchestratorTasks({ tasks, isRunning }: Props) {
  const sorted = [...tasks].sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0));
  const counts = {
    completed: sorted.filter(t => t.status === 'completed').length,
    running: sorted.filter(t => t.status === 'running').length,
    pending: sorted.filter(t => t.status === 'pending').length,
    failed: sorted.filter(t => t.status === 'failed').length,
    superseded: sorted.filter(t => t.status === 'superseded').length,
  };
  const total = sorted.length;
  const progress = total > 0 ? Math.round(((counts.completed + counts.failed + counts.superseded) / total) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/30 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1"><span className="font-semibold text-zinc-200">{total}</span> tarefas</span>
            <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />{counts.completed}</span>
            {counts.running > 0 && <span className="flex items-center gap-1 text-blue-400"><Loader2 className="h-3 w-3 animate-spin" />{counts.running}</span>}
            {counts.pending > 0 && <span className="flex items-center gap-1 text-zinc-500"><Clock className="h-3 w-3" />{counts.pending}</span>}
            {counts.failed > 0 && <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" />{counts.failed}</span>}
            {counts.superseded > 0 && <span className="flex items-center gap-1 text-amber-400" title="Tarefas substituídas pelo replanejamento"><MinusCircle className="h-3 w-3" />{counts.superseded}</span>}
          </div>
          <span className="text-[10px] text-zinc-600 font-mono">{progress}%</span>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500" style={{ width: `${total > 0 ? (counts.completed / total) * 100 : 0}%` }} />
          <div className="h-full bg-red-500/60" style={{ width: `${total > 0 ? (counts.failed / total) * 100 : 0}%` }} />
          <div className="h-full bg-amber-500/60" style={{ width: `${total > 0 ? (counts.superseded / total) * 100 : 0}%` }} />
          {isRunning && <div className="h-full flex-1 bg-blue-500/30 animate-pulse" style={{ width: '2px' }} />}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <div className="h-10 w-10 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mx-auto">
                <FileCode className="h-5 w-5 text-zinc-600" />
              </div>
              <p className="text-xs text-zinc-600">Nenhum plano ainda</p>
              <p className="text-[11px] text-zinc-700">{isRunning ? 'Gerando plano...' : 'Inicie o orquestrador para gerar um plano'}</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {sorted.map((task, i) => (
              <TaskCard key={task.id ?? `task-${i}`} task={task} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
