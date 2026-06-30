import { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import { api } from '../lib/api';
import type { OrchestratorStatusInfo, OrchestratorStepInfo, OrchestratorSessionInfo } from '../types';
import { useSocket } from './useSocket';

export interface LogEntry {
  role: string;
  message: string;
  timestamp: string;
}

export function useOrchestrator() {
  const [status, setStatus] = useState<OrchestratorStatusInfo | null>(null);
  const [steps, setSteps] = useState<OrchestratorStepInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const onStatus = (data: any) => {
      setStatus(prev => prev ? { ...prev, isRunning: data.status === 'running', session: prev.session ? { ...prev.session, status: data.status, progressPercent: data.progressPercent ?? prev.session.progressPercent } : prev.session } : null);
      addLog('orchestrator', `Status: ${data.status} ${data.progressPercent ? `(${data.progressPercent}%)` : ''}`);
    };

    const onStep = (data: any) => {
      setSteps(prev => [...prev, {
        id: `step-${data.stepNumber}-${Date.now()}`,
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
      }]);
      addLog(data.role, `${data.action}: ${data.input?.slice(0, 100) ?? ''}`);
    };

    const onProgress = (data: any) => {
      setStatus(prev => prev ? { ...prev, session: prev.session ? { ...prev.session, progressPercent: data.progressPercent, currentStep: data.currentStep } : prev.session } : null);
    };

    const onError = (data: any) => {
      addLog(data.role ?? 'system', `Error: ${data.error}`);
    };

    const onComplete = (data: any) => {
      setStatus(prev => prev ? { ...prev, isRunning: false, session: prev.session ? { ...prev.session, status: data.status } : prev.session } : null);
      addLog('orchestrator', `Session ${data.status}`);
    };

    socket.on('orchestrator:status', onStatus);
    socket.on('orchestrator:step', onStep);
    socket.on('orchestrator:progress', onProgress);
    socket.on('orchestrator:error', onError);
    socket.on('orchestrator:complete', onComplete);

    return () => {
      socket.off('orchestrator:status', onStatus);
      socket.off('orchestrator:step', onStep);
      socket.off('orchestrator:progress', onProgress);
      socket.off('orchestrator:error', onError);
      socket.off('orchestrator:complete', onComplete);
    };
  }, [socket]);

  const addLog = useCallback((role: string, message: string) => {
    setLogs(prev => [...prev.slice(-200), { role, message, timestamp: new Date().toISOString() }]);
  }, []);

  const start = useCallback(async (objective: string, mdFiles?: File[]) => {
    setIsLoading(true);
    try {
      const mdPaths: string[] = [];

      if (mdFiles && mdFiles.length > 0) {
        const uploaded = await api.files.upload(mdFiles);
        for (const name of uploaded.uploaded ?? []) {
          mdPaths.push(name);
        }
      }

      const result = await api.orchestrator.start({ objective, mdFiles: mdPaths.length > 0 ? mdPaths : undefined });
      setStatus(prev => prev ? { ...prev, isRunning: true, currentSessionId: result.session.id, session: result.session as OrchestratorSessionInfo } : null);
      addLog('orchestrator', `Started: ${objective.slice(0, 80)}${mdPaths.length > 0 ? ` with ${mdPaths.length} .md file(s)` : ''}`);

      if (socket && result.session.id) {
        socket.emit('orchestrator:subscribe', { sessionId: result.session.id });
      }
    } catch (err: any) {
      addLog('system', `Start failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [socket, status, addLog]);

  const stop = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    try {
      await api.orchestrator.stop(status.session.id);
      setStatus(prev => prev ? { ...prev, isRunning: false } : null);
      addLog('orchestrator', 'Stopped');
    } catch (err: any) {
      addLog('system', `Stop failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const pause = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    try {
      await api.orchestrator.pause(status.session.id);
      addLog('orchestrator', 'Paused');
    } catch (err: any) {
      addLog('system', `Pause failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const resume = useCallback(async () => {
    if (!status?.session?.id) return;
    setIsLoading(true);
    try {
      await api.orchestrator.resume(status.session.id);
      addLog('orchestrator', 'Resumed');
    } catch (err: any) {
      addLog('system', `Resume failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, addLog]);

  const uploadMd = useCallback(async (files: File[]) => {
    if (!status?.session?.id) return;
    try {
      await api.orchestrator.uploadMd(status.session.id, files);
      addLog('orchestrator', `Uploaded ${files.length} .md file(s)`);
    } catch (err: any) {
      addLog('system', `Upload failed: ${err.message}`);
    }
  }, [status, addLog]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.orchestrator.status();
      setStatus(data);
      if (data.session) {
        const stepsData = await api.orchestrator.steps(data.session.id, 100, 0);
        setSteps(stepsData.steps);
      }
    } catch (err: any) {
      addLog('system', `Refresh failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [addLog]);

  return { status, steps, logs, isLoading, start, stop, pause, resume, uploadMd, refresh };
}
