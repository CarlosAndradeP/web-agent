import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import type { Message } from '../types';

export interface ToolCallInfo {
  toolName: string;
  toolCallId: string;
  input?: any;
  result?: any;
  stepNumber?: number;
  durationMs?: number;
  status?: 'running' | 'completed' | 'error';
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  isUser: boolean;
  toolCalls?: ToolCallInfo[];
  timestamp?: number;
  createdFiles?: string[];
  createdFileCount?: number;
}

export type ChatStatus = 'idle' | 'connecting' | 'running' | 'awaiting_approval' | 'completed' | 'cancelling' | 'cancelled' | 'error';

export function useChat(sessionId: string, options?: { onCreditsRequired?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const attachedFilesRef = useRef<string[]>([]);
  const historyRequestRef = useRef(0);

  // Ref to always read the latest messages without stale closure
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const requestId = ++historyRequestRef.current;
    setMessages([]);
    setCurrentStep(0);
    setIsStreaming(false);
    setStatus('idle');
    setCurrentToolName(null);
    setHistoryError(null);
    if (!sessionId) {
      setIsLoadingHistory(false);
      return;
    }
    setIsLoadingHistory(true);
    api.sessions.messages(sessionId).then(data => {
      if (requestId !== historyRequestRef.current) return;
      const loaded: ChatMessage[] = data.messages
        .filter((m: Message) => m.role === 'user' || m.role === 'assistant')
        .map((m: Message) => {
          let parsedToolData: any;
          try { parsedToolData = m.toolCalls ? JSON.parse(m.toolCalls) : undefined; } catch { parsedToolData = undefined; }
          return {
          id: m.id,
          role: m.role,
          content: m.content || '',
          isUser: m.role === 'user',
          timestamp: new Date(m.createdAt).getTime(),
          toolCalls: Array.isArray(parsedToolData) ? parsedToolData : parsedToolData?.calls,
          createdFiles: Array.isArray(parsedToolData?.createdFiles) ? parsedToolData.createdFiles : undefined,
          createdFileCount: typeof parsedToolData?.createdFileCount === 'number' ? parsedToolData.createdFileCount : undefined,
        };
        });
      messagesRef.current = loaded;
      setMessages(loaded);
    }).catch((err: Error) => {
      if (requestId === historyRequestRef.current) {
        setHistoryError(err.message || 'Não foi possível carregar o histórico.');
      }
    }).finally(() => {
      if (requestId === historyRequestRef.current) setIsLoadingHistory(false);
    });
  }, [sessionId, historyReloadKey]);

  const send = useCallback(async (content: string, model: string, maxSteps?: number) => {
    // Prepend attached file context to the message if any
    const attachedFiles = attachedFilesRef.current;
    let effectiveContent = content;
    if (attachedFiles.length > 0) {
      const fileList = attachedFiles.join(', ');
      effectiveContent = `[The user uploaded these files to the workspace: ${fileList}. They may reference them in their message.]\n\n${content}`;
      attachedFilesRef.current = [];
    }

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, isUser: true, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStatus('connecting');
    setCurrentStep(0);
    setTotalSteps(maxSteps || 20);

    // Only user/assistant turns are real conversation history. `system` entries
    // here are local-only UI notices (slash commands, upload feedback) and must
    // never be sent to the server — `chat.ts` rejects requests containing them.
    const allMessages = [...messagesRef.current, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
    // Replace last message content with effective content (including attached files context)
    allMessages[allMessages.length - 1].content = effectiveContent;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.chat.stream(sessionId, model, allMessages, maxSteps, controller.signal);

      if (!response.ok) {
        if (response.status === 402) {
          options?.onCreditsRequired?.();
          throw new Error('Créditos esgotados. Fale com um administrador para adicionar mais créditos.');
        }
        throw new Error(`Erro da API: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let pendingToolCalls: ToolCallInfo[] = [];
      let streamFailed = false;
      let didFinish = false;
      let wasCancelled = false;

      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', isUser: false, toolCalls: [], timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);

      if (reader) {
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let reachedTerminalEvent = false;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (data.type === 'task-start') {
                activeTaskIdRef.current = data.taskId ?? null;
                setStatus('running');
              } else if (data.type === 'text-delta') {
                assistantContent += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  const index = updated.findIndex(message => message.id === assistantId);
                  if (index >= 0) updated[index] = { ...updated[index], content: assistantContent, toolCalls: [...pendingToolCalls] };
                  return updated;
                });
              } else if (data.type === 'tool-call') {
                const tc: ToolCallInfo = {
                  toolName: data.toolName,
                  toolCallId: data.toolCallId,
                  input: data.input,
                  status: 'running',
                };
                pendingToolCalls = [...pendingToolCalls, tc];
                setCurrentToolName(data.toolName);
                setMessages(prev => {
                  const updated = [...prev];
                  const index = updated.findIndex(message => message.id === assistantId);
                  if (index >= 0) updated[index] = { ...updated[index], toolCalls: [...pendingToolCalls] };
                  return updated;
                });
              } else if (data.type === 'tool-result') {
                const idx = pendingToolCalls.findIndex(tc => tc.toolCallId === data.toolCallId);
                if (idx >= 0) {
                  pendingToolCalls[idx] = {
                    ...pendingToolCalls[idx],
                    result: data.result,
                    stepNumber: data.stepNumber,
                    durationMs: data.durationMs,
                    status: 'completed',
                  };
                }
                setCurrentToolName(null);
                setMessages(prev => {
                  const updated = [...prev];
                  const index = updated.findIndex(message => message.id === assistantId);
                  if (index >= 0) updated[index] = { ...updated[index], toolCalls: [...pendingToolCalls] };
                  return updated;
                });
              } else if (data.type === 'step-start') {
                const step = data.stepNumber ?? 0;
                setCurrentStep(step);
              } else if (data.type === 'step-end') {
                const step = data.stepNumber ?? 0;
                setCurrentStep(step);
              } else if (data.type === 'finish') {
                didFinish = true;
                setStatus('completed');
                setMessages(prev => {
                  const updated = [...prev];
                  const index = updated.findIndex(message => message.id === assistantId);
                  if (index >= 0) {
                    updated[index] = {
                      ...updated[index],
                      createdFiles: Array.isArray(data.createdFiles) ? data.createdFiles : [],
                      createdFileCount: typeof data.createdFileCount === 'number' ? data.createdFileCount : 0,
                    };
                  }
                  return updated;
                });
                reachedTerminalEvent = true;
              } else if (data.type === 'cancelled') {
                didFinish = true;
                wasCancelled = true;
                setStatus('cancelled');
                reachedTerminalEvent = true;
              } else if (data.type === 'error') {
                streamFailed = true;
                didFinish = true;
                setStatus('error');
                console.error('[Chat] Stream error:', data.error);
                const errorTc: ToolCallInfo = {
                  toolName: 'error',
                  toolCallId: `error-${Date.now()}`,
                  result: data.error,
                  status: 'error',
                };
                pendingToolCalls = [...pendingToolCalls, errorTc];
                setMessages(prev => {
                  const updated = [...prev];
                  const index = updated.findIndex(message => message.id === assistantId);
                  if (index >= 0) updated[index] = { ...updated[index], content: assistantContent || `Erro: ${data.error}`, toolCalls: [...pendingToolCalls] };
                  return updated;
                });
                reachedTerminalEvent = true;
              }
            } catch (parseErr) {
              console.warn('[Chat] Failed to parse SSE data:', dataStr, parseErr);
            }
          }
          if (reachedTerminalEvent) {
            await reader.cancel();
            break;
          }
        }
      }

      if (!didFinish && !streamFailed && !controller.signal.aborted) {
        streamFailed = true;
        setStatus('error');
        throw new Error('A conexão com o agente foi encerrada antes da conclusão.');
      }

      if (!assistantContent && pendingToolCalls.length === 0) {
        setMessages(prev => {
          const updated = [...prev];
          const index = updated.findIndex(message => message.id === assistantId);
          if (index >= 0) updated[index] = { ...updated[index], content: wasCancelled ? 'Tarefa interrompida.' : didFinish ? 'Tarefa concluída sem uma resposta em texto.' : 'A tarefa foi interrompida antes de gerar uma resposta.' };
          return updated;
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatus('cancelled');
      } else {
        setStatus('error');
        console.error('[Chat] Request error:', err);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.content.startsWith('Erro:')) return prev;
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `Erro: ${err.message}`, isUser: false, timestamp: Date.now() }];
        });
      }
    } finally {
      setIsStreaming(false);
      setCurrentToolName(null);
      abortRef.current = null;
      activeTaskIdRef.current = null;
    }
  }, [sessionId, options]);

  const cancel = useCallback(async () => {
    // First, cancel the server-side task so the agent stops executing
    const taskId = activeTaskIdRef.current;
    setStatus('cancelling');
    if (taskId) {
      try {
        await api.tasks.cancel(taskId);
      } catch (err) {
        console.warn('[Chat] Server cancel failed, continuing with local abort', err);
      }
    }
    // Then abort the local stream reader
    abortRef.current?.abort();
    setIsStreaming(false);
    setStatus('cancelled');
    setCurrentToolName(null);
    activeTaskIdRef.current = null;
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    const msg: ChatMessage = { id: crypto.randomUUID(), role: 'system', content, isUser: false, timestamp: Date.now() };
    setMessages(prev => [...prev, msg]);
  }, []);

  const addAttachedFiles = useCallback((filePaths: string[]) => {
    attachedFilesRef.current = [...attachedFilesRef.current, ...filePaths];
  }, []);

  const clearAttachedFiles = useCallback(() => {
    attachedFilesRef.current = [];
  }, []);

  const clearChat = useCallback(async () => {
    setMessages([]);
    setCurrentStep(0);
    setStatus('idle');
    setCurrentToolName(null);
    attachedFilesRef.current = [];
    try {
      await api.sessions.clearMessages(sessionId);
    } catch (err) {
      console.warn('[Chat] Failed to clear messages from server', err);
    }
  }, [sessionId]);

  const reloadHistory = useCallback(() => setHistoryReloadKey(key => key + 1), []);

  return { messages, send, cancel, isStreaming, status, isLoadingHistory, historyError, reloadHistory, currentStep, totalSteps, currentToolName, addSystemMessage, addAttachedFiles, clearAttachedFiles, clearChat };
}
