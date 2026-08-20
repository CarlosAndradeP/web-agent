import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { OrchestratorStatusInfo, OrchestratorStepInfo, OrchestratorSessionInfo, OrchestratorTaskInfo } from '../types';
import { useSocket } from './useSocket';

export interface LogEntry {
  role: string;
  message: string;
  timestamp: string;
}

const statusLabels: Record<string, string> = {
  idle: 'ocioso',
  running: 'em execução',
  paused: 'pausado',
  completed: 'concluído',
  failed: 'falhou',
};

export function useOrchestrator(sessionId?: string) {
  const [status, setStatus] = useState<OrchestratorStatusInfo | null>(null);
  const [steps, setSteps] = useState<OrchestratorStepInfo[]>([]);
  const [tasks, setTasks] = useState<OrchestratorTaskInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { socket, connected } = useSocket();
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = null;
    setStatus(null);
    setSteps([]);
    setTasks([]);
    setLogs([]);
    setError(null);
  }, [sessionId]);

  const addLog = useCallback((role: string, message: string) => {
    setLogs(prev => [...prev.slice(-200), { role, message, timestamp: new Date().toISOString() }]);
  }, []);

  const refreshSessionData = useCallback(async (orchestratorSessionId: string) => {
    activeSessionIdRef.current = orchestratorSessionId;
    const [sessionData, stepsData, tasksData] = await Promise.all([
      api.orchestrator.sessionStatus(orchestratorSessionId),
      api.orchestrator.steps(orchestratorSessionId, 200, 0),
      api.orchestrator.tasks(orchestratorSessionId),
    ]);

    if (activeSessionIdRef.current !== orchestratorSessionId) return;

    setStatus(prev => ({
      isRunning: sessionData.isRunning,
      lastHeartbeat: prev?.lastHeartbeat ?? new Date().toISOString(),
      currentSessionId: orchestratorSessionId,
      totalStepsCompleted: sessionData.session.totalStepsUsed,
      session: sessionData.session,
    }));
    setSteps(stepsData.steps);
    setTasks(tasksData.tasks);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const isActiveSessionEvent = (data: any) => Boolean(activeSessionIdRef.current && data?.sessionId === activeSessionIdRef.current);

    const onStatus = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      setStatus(prev => prev ? { ...prev, isRunning: data.status === 'running', session: prev.session ? { ...prev.session, status: data.status, progressPercent: data.progressPercent ?? prev.session.progressPercent } : prev.session } : null);
      addLog('orchestrator', `Status: ${statusLabels[data.status] || data.status} ${data.progressPercent !== undefined ? `(${data.progressPercent}%)` : ''}`);
    };

    const onStep = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      setSteps(prev => {
        const step: OrchestratorStepInfo = {
        id: data.stepId ?? `step-${data.sessionId}-${data.stepNumber}`,
        orchestratorSessionId: data.sessionId,
        stepNumber: data.stepNumber,
        role: data.role,
        model: data.model,
        action: data.action,
        input: data.input?.slice(0, 200) ?? '',
        output: data.output?.slice(0, 200) ?? null,
        status: data.status,
        errorMessage: null,
        durationMs: data.durationMs ?? null,
        createdAt: new Date().toISOString(),
        completedAt: data.status === 'completed' ? new Date().toISOString() : null,
        };
        const existingIndex = prev.findIndex(item => item.id === step.id || (item.orchestratorSessionId === step.orchestratorSessionId && item.stepNumber === step.stepNumber));
        if (existingIndex < 0) return [...prev, step].slice(-200);
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...step };
        return updated;
      });
      addLog(data.role, `${data.action}: ${data.input?.slice(0, 100) ?? ''}`);
    };

    const onProgress = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      setStatus(prev => prev ? { ...prev, session: prev.session ? { ...prev.session, progressPercent: data.progressPercent, currentStep: data.currentStep } : prev.session } : null);
    };

    const onTask = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      setTasks(prev => {
        const existingIdx = prev.findIndex(t => t.id === data.taskId);
        const newTask: OrchestratorTaskInfo = {
          id: data.taskId,
          orchestratorSessionId: data.sessionId,
          name: data.name ?? '',
          description: data.description ?? '',
          status: data.status,
          role: data.role ?? 'programador',
          dependsOn: data.dependsOn ?? null,
          output: null,
          errorMessage: data.errorMessage ?? null,
          stepNumber: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            status: data.status,
            name: data.name || updated[existingIdx].name,
            description: data.description || updated[existingIdx].description,
            role: data.role || updated[existingIdx].role,
            dependsOn: data.dependsOn ?? updated[existingIdx].dependsOn,
            errorMessage: data.errorMessage ?? (data.status === 'completed' || data.status === 'running' ? null : updated[existingIdx].errorMessage),
            updatedAt: new Date().toISOString(),
          };
          return updated;
        }
        return [...prev, newTask];
      });
    };

    const onPlan = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      if (data.sessionId) void refreshSessionData(data.sessionId);
    };

    const onError = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      addLog(data.role ?? 'system', `Erro: ${data.error}`);
    };

    const onComplete = (data: any) => {
      if (!isActiveSessionEvent(data)) return;
      setStatus(prev => prev ? { ...prev, isRunning: false, session: prev.session ? { ...prev.session, status: data.status } : prev.session } : null);
      addLog('orchestrator', `Sessão ${statusLabels[data.status] || data.status}`);
      if (data.sessionId) void refreshSessionData(data.sessionId);
    };

    socket.on('orchestrator:status', onStatus);
    socket.on('orchestrator:step', onStep);
    socket.on('orchestrator:progress', onProgress);
    socket.on('orchestrator:task', onTask);
    socket.on('orchestrator:plan', onPlan);
    socket.on('orchestrator:error', onError);
    socket.on('orchestrator:complete', onComplete);

    return () => {
      socket.off('orchestrator:status', onStatus);
      socket.off('orchestrator:step', onStep);
      socket.off('orchestrator:progress', onProgress);
      socket.off('orchestrator:task', onTask);
      socket.off('orchestrator:plan', onPlan);
      socket.off('orchestrator:error', onError);
      socket.off('orchestrator:complete', onComplete);
    };
  }, [socket, addLog, refreshSessionData]);

  useEffect(() => {
    const orchestratorSessionId = status?.session?.id;
    if (!socket || !connected || !orchestratorSessionId) return;

    socket.emit('orchestrator:subscribe', { sessionId: orchestratorSessionId });
    return () => {
      socket.emit('orchestrator:unsubscribe', { sessionId: orchestratorSessionId });
    };
  }, [socket, connected, status?.session?.id]);

  const start = useCallback(async (objective: string, mdFiles?: File[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const mdPaths: string[] = [];

      if (mdFiles && mdFiles.length > 0) {
        const uploaded = await api.orchestrator.prepareMd(sessionId, mdFiles);
        for (const name of uploaded.uploaded ?? []) {
          mdPaths.push(name);
        }
      }

      const result = await api.orchestrator.start({ sessionId, objective, mdFiles: mdPaths.length > 0 ? mdPaths : undefined });
      activeSessionIdRef.current = result.session.id;
      const startedSession: OrchestratorSessionInfo = { ...result.session, status: 'running' };
      setStatus(prev => ({
        isRunning: true,
        lastHeartbeat: prev?.lastHeartbeat ?? new Date().toISOString(),
        currentSessionId: startedSession.id,
        totalStepsCompleted: prev?.totalStepsCompleted ?? 0,
        session: startedSession,
      }));
      setSteps([]);
      setTasks([]);
      addLog('orchestrator', `Iniciado: ${objective.slice(0, 80)}${mdPaths.length > 0 ? ` com ${mdPaths.length} arquivo(s) .md` : ''}`);

      if (socket && connected && result.session.id) {
        socket.emit('orchestrator:subscribe', { sessionId: result.session.id });
      }
      void refreshSessionData(result.session.id);
    } catch (err: any) {
      setError(err.message || 'Falha ao iniciar o modo autônomo');
      addLog('system', `Falha ao iniciar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [socket, connected, sessionId, addLog, refreshSessionData]);

  const stop = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.orchestrator.stop(status.session.id);
      setStatus(prev => prev ? { ...prev, isRunning: false, session: prev.session ? { ...prev.session, status: 'idle' } : prev.session } : null);
      addLog('orchestrator', 'Parado');
    } catch (err: any) {
      setError(err.message || 'Falha ao parar o modo autônomo');
      addLog('system', `Falha ao parar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const pause = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.orchestrator.pause(status.session.id);
      setStatus(prev => prev ? { ...prev, isRunning: false, session: prev.session ? { ...prev.session, status: 'paused' } : prev.session } : null);
      addLog('orchestrator', 'Pausado');
    } catch (err: any) {
      setError(err.message || 'Falha ao pausar o modo autônomo');
      addLog('system', `Falha ao pausar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const resume = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.orchestrator.resume(status.session.id);
      setStatus(prev => prev ? { ...prev, isRunning: true, session: prev.session ? { ...prev.session, status: 'running' } : prev.session } : null);
      addLog('orchestrator', 'Retomado');
    } catch (err: any) {
      setError(err.message || 'Falha ao retomar o modo autônomo');
      addLog('system', `Falha ao retomar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const uploadMd = useCallback(async (files: File[]) => {
    if (!status?.session?.id) return;
    setError(null);
    try {
      await api.orchestrator.uploadMd(status.session.id, files);
      addLog('orchestrator', `${files.length} arquivo(s) .md enviado(s)`);
    } catch (err: any) {
      setError(err.message || 'Falha ao enviar especificações');
      addLog('system', `Falha no upload: ${err.message}`);
    }
  }, [status, addLog]);

  const refreshTasks = useCallback(async () => {
    if (!status?.session?.id) return;
    try {
      const data = await api.orchestrator.tasks(status.session.id);
      setTasks(data.tasks);
    } catch (err: any) {
      setError(err.message || 'Falha ao atualizar tarefas');
      addLog('system', `Falha ao atualizar tarefas: ${err.message}`);
    }
  }, [status, addLog]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.orchestrator.status(sessionId);
      setStatus(data);
      activeSessionIdRef.current = data.session?.id ?? null;
      if (data.session) {
        const stepsData = await api.orchestrator.steps(data.session.id, 200, 0);
        setSteps(stepsData.steps);
        const tasksData = await api.orchestrator.tasks(data.session.id);
        setTasks(tasksData.tasks);
      } else {
        setSteps([]);
        setTasks([]);
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao atualizar o modo autônomo');
      addLog('system', `Falha ao atualizar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [addLog, sessionId]);

  return { status, steps, tasks, logs, isLoading, error, start, stop, pause, resume, uploadMd, refresh, refreshTasks };
}
