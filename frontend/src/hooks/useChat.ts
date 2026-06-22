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
  role: string;
  content: string;
  isUser: boolean;
  toolCalls?: ToolCallInfo[];
  timestamp?: number;
}

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.sessions.messages(sessionId).then(data => {
      const loaded: ChatMessage[] = data.messages
        .filter((m: Message) => m.role === 'user' || m.role === 'assistant')
        .map((m: Message) => ({
          role: m.role,
          content: m.content || '',
          isUser: m.role === 'user',
          timestamp: new Date(m.createdAt).getTime(),
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        }));
      setMessages(loaded);
    }).catch(() => {});
  }, [sessionId]);

  const send = useCallback(async (content: string, model: string, maxSteps?: number) => {
    const userMsg: ChatMessage = { role: 'user', content, isUser: true, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setCurrentStep(0);
    setTotalSteps(maxSteps || 20);

    const allMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.chat.stream(sessionId, model, allMessages, maxSteps);

      if (!response.ok) {
        if (response.status === 402) {
          throw new Error('Créditos esgotados. Contate o administrador para adicionar mais créditos.');
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let pendingToolCalls: ToolCallInfo[] = [];

      const assistantMsg: ChatMessage = { role: 'assistant', content: '', isUser: false, toolCalls: [], timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);

      if (reader) {
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (data.type === 'text-delta') {
                assistantContent += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent, toolCalls: [...pendingToolCalls] };
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
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], toolCalls: [...pendingToolCalls] };
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
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], toolCalls: [...pendingToolCalls] };
                  return updated;
                });
              } else if (data.type === 'step-start') {
                const step = data.stepNumber ?? 0;
                setCurrentStep(step);
              } else if (data.type === 'step-end') {
                const step = data.stepNumber ?? 0;
                setCurrentStep(step);
              } else if (data.type === 'finish') {
                setCurrentStep(prev => prev + 1);
              } else if (data.type === 'error') {
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
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: assistantContent || `Error: ${data.error}`,
                    toolCalls: [...pendingToolCalls],
                  };
                  return updated;
                });
              }
            } catch (parseErr) {
              console.warn('[Chat] Failed to parse SSE data:', dataStr, parseErr);
            }
          }
        }
      }

      if (!assistantContent && pendingToolCalls.length === 0) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: 'Agent processed the task but produced no text output. Check the Tasks panel for details.',
          };
          return updated;
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[Chat] Request error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, isUser: false, timestamp: Date.now() }]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [sessionId, messages]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { messages, send, cancel, isStreaming, currentStep, totalSteps };
}
