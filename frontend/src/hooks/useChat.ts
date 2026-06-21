import { useState, useRef, useCallback } from 'react';
import type { Message } from '../types';
import { api } from '../lib/api';

interface ChatMessage {
  role: string;
  content: string;
  isUser: boolean;
  toolCalls?: any[];
}

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (content: string, model: string, maxSteps?: number) => {
    const userMsg: ChatMessage = { role: 'user', content, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    const allMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.chat.stream(sessionId, model, allMessages, maxSteps);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      const assistantMsg: ChatMessage = { role: 'assistant', content: '', isUser: false };
      setMessages(prev => [...prev, assistantMsg]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text-delta') {
                assistantContent += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, isUser: false }]);
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

  return { messages, send, cancel, isStreaming };
}
