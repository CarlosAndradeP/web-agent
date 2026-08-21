import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, FlaskConical, Gauge, Search, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import type { AdminModelInfo, BenchmarkCategory, ModelBenchmarkRun } from '../types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';

const CATEGORY_LABELS: Record<BenchmarkCategory, string> = {
  chat: 'Chat rápido',
  reasoning: 'Raciocínio',
  coding: 'Código',
};

interface Props {
  models: AdminModelInfo[];
  onModelsChanged: () => Promise<void>;
}

interface RankedModel {
  modelId: string;
  attempts: number;
  successes: number;
  stability: number;
  latency: number | null;
  quality: number;
  score: number;
  errors: string[];
}

export default function ModelBenchmarkPanel({ models, onModelsChanged }: Props) {
  const [runs, setRuns] = useState<ModelBenchmarkRun[]>([]);
  const [currentRun, setCurrentRun] = useState<ModelBenchmarkRun | null>(null);
  const [categories, setCategories] = useState<Set<BenchmarkCategory>>(new Set(['chat', 'reasoning', 'coding']));
  const [repetitions, setRepetitions] = useState(1);
  const [includeDisabled, setIncludeDisabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [speedFilter, setSpeedFilter] = useState<'all' | 'fast' | 'medium' | 'slow'>('all');
  const [stabilityFilter, setStabilityFilter] = useState<'all' | 'stable' | 'unstable' | 'errors'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'speed' | 'stability' | 'quality'>('score');

  const loadRuns = useCallback(async () => {
    const data = await api.admin.modelBenchmarks(8);
    setRuns(data.runs);
    setCurrentRun(previous => previous ? data.runs.find(run => run.id === previous.id) ?? previous : data.runs[0] ?? null);
  }, []);

  useEffect(() => {
    loadRuns().catch(err => setMessage(err instanceof Error ? err.message : 'Falha ao carregar benchmarks'));
  }, [loadRuns]);

  useEffect(() => {
    if (!currentRun || (currentRun.status !== 'running' && currentRun.status !== 'pending')) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api.admin.modelBenchmark(currentRun.id);
        setCurrentRun(data.run);
        if (data.run.status === 'completed' || data.run.status === 'failed') await loadRuns();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Falha ao acompanhar o benchmark');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [currentRun?.id, currentRun?.status, loadRuns]);

  const startBenchmark = async () => {
    const modelIds = models.filter(model => !model.offline && (includeDisabled || model.enabled)).map(model => model.id);
    if (!modelIds.length || !categories.size) return;
    setStarting(true);
    setMessage(null);
    try {
      const data = await api.admin.startModelBenchmark({ modelIds, categories: Array.from(categories), repetitions });
      setCurrentRun(data.run);
      setRuns(previous => [data.run, ...previous.filter(run => run.id !== data.run.id)]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível iniciar o benchmark');
      await loadRuns().catch(() => undefined);
    } finally {
      setStarting(false);
    }
  };

  const ranked = useMemo<RankedModel[]>(() => {
    if (!currentRun) return [];
    const grouped = new Map<string, typeof currentRun.results>();
    for (const result of currentRun.results) {
      const list = grouped.get(result.modelId) ?? [];
      list.push(result);
      grouped.set(result.modelId, list);
    }
    const base = Array.from(grouped, ([modelId, results]) => {
      const successful = results.filter(result => result.success);
      const latency = successful.length
        ? Math.round(successful.reduce((sum, result) => sum + (result.latencyMs ?? 0), 0) / successful.length)
        : null;
      return {
        modelId,
        attempts: results.length,
        successes: successful.length,
        stability: Math.round((successful.length / results.length) * 100),
        latency,
        quality: Math.round(results.reduce((sum, result) => sum + result.qualityScore, 0) / results.length),
        score: 0,
        errors: [...new Set(results.flatMap(result => result.errorMessage ? [result.errorMessage] : []))],
      };
    });
    const fastest = Math.min(...base.flatMap(item => item.latency === null ? [] : [item.latency]));
    return base.map(item => {
      const speedScore = item.latency && Number.isFinite(fastest) ? Math.min(100, (fastest / item.latency) * 100) : 0;
      return { ...item, score: Math.round(item.quality * 0.55 + item.stability * 0.35 + speedScore * 0.1) };
    });
  }, [currentRun]);

  const visibleRanked = useMemo(() => ranked.filter(item => {
    if (!item.modelId.toLowerCase().includes(search.toLowerCase())) return false;
    if (speedFilter === 'fast' && (item.latency === null || item.latency >= 3000)) return false;
    if (speedFilter === 'medium' && (item.latency === null || item.latency < 3000 || item.latency > 10000)) return false;
    if (speedFilter === 'slow' && item.latency !== null && item.latency <= 10000) return false;
    if (stabilityFilter === 'stable' && item.stability < 90) return false;
    if (stabilityFilter === 'unstable' && (item.stability >= 90 || item.stability === 0)) return false;
    if (stabilityFilter === 'errors' && item.errors.length === 0) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'speed') return (a.latency ?? Number.MAX_SAFE_INTEGER) - (b.latency ?? Number.MAX_SAFE_INTEGER);
    if (sortBy === 'stability') return b.stability - a.stability;
    if (sortBy === 'quality') return b.quality - a.quality;
    return b.score - a.score;
  }), [ranked, search, speedFilter, stabilityFilter, sortBy]);

  const bestByCategory = useMemo(() => {
    if (!currentRun) return [];
    return currentRun.categories.map(category => {
      const results = currentRun.results.filter(result => result.category === category && result.success);
      const candidates = new Map<string, { score: number; latency: number; count: number }>();
      for (const result of results) {
        const value = candidates.get(result.modelId) ?? { score: 0, latency: 0, count: 0 };
        value.score += result.qualityScore;
        value.latency += result.latencyMs ?? 0;
        value.count += 1;
        candidates.set(result.modelId, value);
      }
      const winner = Array.from(candidates, ([modelId, value]) => ({
        modelId,
        quality: value.score / value.count,
        latency: value.latency / value.count,
      })).sort((a, b) => b.quality - a.quality || a.latency - b.latency)[0];
      return { category, winner };
    });
  }, [currentRun]);

  const disableModel = async (modelId: string) => {
    await api.admin.updateModel(modelId, { enabled: false });
    await onModelsChanged();
  };

  const disableAllFailures = async () => {
    const failedIds = ranked.filter(item => item.errors.length > 0).map(item => item.modelId);
    if (!failedIds.length) return;
    await api.admin.batchUpdateModels(failedIds, false);
    await onModelsChanged();
    setMessage(`${failedIds.length} modelo(s) com erro foram desativados.`);
  };

  const running = currentRun?.status === 'running' || currentRun?.status === 'pending';
  const modelCount = models.filter(model => !model.offline && (includeDisabled || model.enabled)).length;

  return (
    <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Benchmark de modelos</h3>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] text-zinc-500">Compare resposta, raciocínio e código. A nota geral combina qualidade (55%), estabilidade (35%) e velocidade (10%).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={repetitions} onChange={event => setRepetitions(Number(event.target.value))} className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300" disabled={running}>
            <option value={1}>1 tentativa</option>
            <option value={2}>2 tentativas</option>
            <option value={3}>3 tentativas</option>
          </select>
          <Button size="sm" className="h-8 text-[11px]" disabled={starting || running || !modelCount || !categories.size} onClick={startBenchmark}>
            <Activity className={cn('mr-1.5 h-3.5 w-3.5', running && 'animate-pulse')} />
            {running ? 'Testando...' : `Testar ${modelCount} modelo(s)`}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {(Object.keys(CATEGORY_LABELS) as BenchmarkCategory[]).map(category => (
          <button key={category} type="button" disabled={running} onClick={() => setCategories(previous => {
            const next = new Set(previous);
            if (next.has(category)) next.delete(category); else next.add(category);
            return next;
          })} className={cn('rounded-md border px-2.5 py-1.5 transition-colors', categories.has(category) ? 'border-violet-500/50 bg-violet-500/10 text-violet-300' : 'border-zinc-800 text-zinc-500')}>
            {CATEGORY_LABELS[category]}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1.5 text-zinc-400">
          <input type="checkbox" checked={includeDisabled} disabled={running} onChange={event => setIncludeDisabled(event.target.checked)} />
          incluir modelos inativos
        </label>
      </div>

      {message && <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-300">{message}</div>}

      {currentRun && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select value={currentRun.id} onChange={event => setCurrentRun(runs.find(run => run.id === event.target.value) ?? currentRun)} className="h-8 max-w-64 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300">
              {runs.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString('pt-BR')} · {run.status}</option>)}
            </select>
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${currentRun.modelCount ? currentRun.completedModels / currentRun.modelCount * 100 : 0}%` }} /></div>
              <span className="text-[10px] text-zinc-500">{currentRun.completedModels}/{currentRun.modelCount}</span>
            </div>
          </div>

          {bestByCategory.some(item => item.winner) && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {bestByCategory.map(({ category, winner }) => winner && (
                <div key={category} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-400"><Trophy className="h-3 w-3" /> Melhor em {CATEGORY_LABELS[category]}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-zinc-200" title={winner.modelId}>{winner.modelId}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">nota {Math.round(winner.quality)} · {Math.round(winner.latency)} ms</div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-600" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filtrar modelo..." className="h-8 pl-8 text-[11px]" /></div>
            <select value={speedFilter} onChange={event => setSpeedFilter(event.target.value as typeof speedFilter)} className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300">
              <option value="all">Todas velocidades</option><option value="fast">Rápidos (&lt; 3s)</option><option value="medium">Médios (3–10s)</option><option value="slow">Lentos (&gt; 10s/erro)</option>
            </select>
            <select value={stabilityFilter} onChange={event => setStabilityFilter(event.target.value as typeof stabilityFilter)} className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300">
              <option value="all">Toda estabilidade</option><option value="stable">Estáveis (≥ 90%)</option><option value="unstable">Instáveis</option><option value="errors">Com erros</option>
            </select>
            <select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)} className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300">
              <option value="score">Melhor geral</option><option value="speed">Mais rápido</option><option value="stability">Mais estável</option><option value="quality">Maior qualidade</option>
            </select>
            {ranked.some(item => item.errors.length) && <Button variant="outline" size="sm" className="h-8 text-[10px] text-red-400" onClick={disableAllFailures}>Desativar todos com erro</Button>}
          </div>

          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[36px_1fr_90px_90px_80px_80px_100px] gap-2 px-3 py-1.5 text-[9px] uppercase tracking-wider text-zinc-600"><span>#</span><span>Modelo</span><span>Velocidade</span><span>Estabilidade</span><span>Qualidade</span><span>Geral</span><span>Ação</span></div>
              {visibleRanked.map((item, index) => {
                const configured = models.find(model => model.id === item.modelId);
                return <div key={item.modelId} className="grid grid-cols-[36px_1fr_90px_90px_80px_80px_100px] gap-2 border-t border-zinc-900 px-3 py-2.5 text-[11px] items-center">
                  <span className="text-zinc-600">{index + 1}</span>
                  <div className="min-w-0"><div className="truncate font-mono text-zinc-200" title={item.modelId}>{item.modelId}</div>{item.errors[0] && <div className="mt-0.5 truncate text-[9px] text-red-400" title={item.errors.join('\n')}>{item.errors[0]}</div>}</div>
                  <span className={cn('flex items-center gap-1', item.latency !== null && item.latency < 3000 ? 'text-emerald-400' : 'text-zinc-400')}><Clock3 className="h-3 w-3" />{item.latency === null ? '—' : `${item.latency} ms`}</span>
                  <span className={cn('flex items-center gap-1', item.stability >= 90 ? 'text-emerald-400' : item.stability === 0 ? 'text-red-400' : 'text-amber-400')}>{item.stability >= 90 ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{item.stability}%</span>
                  <span className="text-zinc-300">{item.quality}/100</span>
                  <span className="flex items-center gap-1 font-semibold text-violet-300"><Gauge className="h-3 w-3" />{item.score}</span>
                  {item.errors.length ? <Button variant="ghost" size="sm" disabled={configured?.enabled === false} className="h-6 px-2 text-[9px] text-red-400" onClick={() => disableModel(item.modelId)}>{configured?.enabled === false ? 'Desativado' : 'Desativar'}</Button> : <span className="text-[9px] text-emerald-500">aprovado</span>}
                </div>;
              })}
              {!visibleRanked.length && <div className="py-6 text-center text-[11px] text-zinc-600">Ainda não há resultados para estes filtros.</div>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
