import { useState, useMemo } from 'react';
import type { OrchestratorStepInfo } from '../types';
import type { LogEntry } from '../hooks/useOrchestrator';
import { ChevronDown, ChevronRight, Clock, AlertCircle, CheckCircle2, Loader2, Search, BrainCircuit, Shield, FileCode, Code, Eye } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  steps: OrchestratorStepInfo[];
  logs: LogEntry[];
}

const ROLE_COLORS: Record<string, string> = {
  orchestrator: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  auxiliar: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  arquiteto: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  programador: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  revisor: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
};

const ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  auxiliar: 'Auxiliar',
  arquiteto: 'Arquiteto',
  programador: 'Programador',
  revisor: 'Revisor',
};

const ROLE_ICONS: Record<string, any> = {
  orchestrator: BrainCircuit,
  auxiliar: Shield,
  arquiteto: FileCode,
  programador: Code,
  revisor: Eye,
};

const ROLES = ['orchestrator', 'arquiteto', 'programador', 'auxiliar', 'revisor'];

const VIEW_LABELS = {
  all: 'Todos',
  steps: 'Etapas',
  logs: 'Logs',
} as const;

function StepEntry({ step }: { step: OrchestratorStepInfo }) {
  const [expanded, setExpanded] = useState(false);
  const color = ROLE_COLORS[step.role] ?? ROLE_COLORS.orchestrator;

  return (
    <div className="px-3 py-2 border-b border-zinc-800/40">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="h-3 w-3 text-zinc-600 shrink-0" /> : <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />}
        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', color)}>
          {ROLE_LABELS[step.role] ?? step.role}
        </span>
        <span className="text-[11px] text-zinc-400 truncate flex-1">{step.action}: {step.input?.slice(0, 60)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {step.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
          {step.status === 'running' && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
          {step.status === 'failed' && <AlertCircle className="h-3 w-3 text-red-400" />}
          {step.status === 'pending' && <Clock className="h-3 w-3 text-zinc-600" />}
          {step.durationMs != null && (
            <span className="text-[9px] text-zinc-600 font-mono">{(step.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-5 space-y-1.5">
          <div>
              <span className="text-[10px] text-zinc-600 font-medium uppercase">Entrada</span>
            <pre className="text-[11px] text-zinc-400 bg-zinc-900 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.input}</pre>
          </div>
          {step.output && (
            <div>
                <span className="text-[10px] text-zinc-600 font-medium uppercase">Saída</span>
              <pre className="text-[11px] text-zinc-400 bg-zinc-900 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.output}</pre>
            </div>
          )}
          {step.errorMessage && (
            <div>
              <span className="text-[10px] text-red-500 font-medium uppercase">Erro</span>
              <pre className="text-[11px] text-red-400 bg-red-400/5 rounded p-2 mt-0.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{step.errorMessage}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const color = ROLE_COLORS[entry.role] ?? ROLE_COLORS.orchestrator;
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[11px]">
      <span className={cn('font-medium shrink-0', color.split(' ')[0])}>{ROLE_LABELS[entry.role] ?? entry.role}</span>
      <span className="text-zinc-500 truncate flex-1">{entry.message}</span>
      <span className="text-[9px] text-zinc-700 font-mono shrink-0">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

export default function OrchestratorLog({ steps, logs }: Props) {
  const [search, setSearch] = useState('');
  const [activeRoles, setActiveRoles] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<'all' | 'steps' | 'logs'>('all');

  const toggleRole = (role: string) => {
    setActiveRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const filteredEntries = useMemo(() => {
    const lower = search.toLowerCase();
    const roleFilterActive = activeRoles.size > 0;
    const matchesRole = (r: string) => !roleFilterActive || activeRoles.has(r);
    const matchesSearch = (text: string) => !lower || text.toLowerCase().includes(lower);

    const stepEntries = steps
      .filter(s => matchesRole(s.role) && matchesSearch(`${s.action} ${s.input ?? ''} ${s.output ?? ''} ${s.errorMessage ?? ''}`))
      .map(s => ({ type: 'step' as const, data: s }));
    const logEntries = logs
      .filter(l => matchesRole(l.role) && matchesSearch(`${l.role} ${l.message}`))
      .map(l => ({ type: 'log' as const, data: l }));

    let combined = [...stepEntries, ...logEntries];
    if (show === 'steps') combined = stepEntries;
    if (show === 'logs') combined = logEntries;

    return combined.sort((a, b) => {
      const timeA = a.type === 'step' ? a.data.createdAt : a.data.timestamp;
      const timeB = b.type === 'step' ? b.data.createdAt : b.data.timestamp;
      return new Date(timeA).getTime() - new Date(timeB).getTime();
    });
  }, [steps, logs, search, activeRoles, show]);

  const hasFilters = activeRoles.size > 0 || search.trim() !== '';

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/30 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar atividade..."
              className="w-full text-[11px] text-zinc-200 placeholder:text-zinc-600 bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2 py-1 focus:outline-none focus:border-zinc-700"
            />
          </div>
          <div className="flex items-center gap-0.5 bg-zinc-950 border border-zinc-800 rounded p-0.5">
            {(['all', 'steps', 'logs'] as const).map(s => (
              <button
                key={s}
                onClick={() => setShow(s)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] transition-colors',
                  show === s ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'
                )}
              >
                {VIEW_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {ROLES.map(role => {
            const Icon = ROLE_ICONS[role] ?? BrainCircuit;
            const active = activeRoles.has(role);
            return (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-opacity',
                  ROLE_COLORS[role] ?? ROLE_COLORS.orchestrator,
                  active ? 'opacity-100' : 'opacity-40 hover:opacity-70'
                )}
                title={active ? `Filtro: ${ROLE_LABELS[role]} (clique para remover)` : `Filtro: ${ROLE_LABELS[role]} (clique para incluir)`}
              >
                <Icon className="h-2.5 w-2.5" />
                {ROLE_LABELS[role]}
              </button>
            );
          })}
          {hasFilters && (
            <button
              onClick={() => { setActiveRoles(new Set()); setSearch(''); }}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1"
            >
              limpar
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <div className="h-10 w-10 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mx-auto">
                <span className="text-lg text-zinc-600">{hasFilters ? '∅' : '~'}</span>
              </div>
              <p className="text-xs text-zinc-600">{hasFilters ? 'Nenhum resultado' : 'Nenhuma atividade ainda'}</p>
              <p className="text-[11px] text-zinc-700">
                {hasFilters ? 'Tente limpar os filtros' : 'Inicie o orquestrador para começar'}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filteredEntries.map((entry, i) => {
              const key = entry.type === 'step'
                ? `step-${entry.data.id ?? entry.data.stepNumber ?? i}`
                : `log-${entry.data.timestamp ?? i}`;
              return entry.type === 'step'
                ? <StepEntry key={key} step={entry.data} />
                : <LogEntryRow key={key} entry={entry.data} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
