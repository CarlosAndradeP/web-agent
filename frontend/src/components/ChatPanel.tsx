import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import type { AppConfig, ModelInfo, ApprovalRequest } from '../types';
import MessageBubble from './MessageBubble';
import ApprovalDialog from './ApprovalDialog';
import StepProgressBar from './StepProgressBar';
import TypingIndicator from './TypingIndicator';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Send, Square, Paperclip, ChevronDown, Globe, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  sessionId: string;
}

export default function ChatPanel({ sessionId }: Props) {
  const { messages, send, cancel, isStreaming, currentStep, totalSteps, currentToolName } = useChat(sessionId);
  const { socket } = useSocket();
  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let defaultModel = '';
    api.config.get()
      .then(cfg => { defaultModel = cfg.defaultModel; })
      .catch(() => {})
      .finally(() => {
        api.models.list().then(data => {
          setModels(data.models);
          if (data.models.length > 0) {
            const exists = defaultModel && data.models.find(m => m.id === defaultModel);
            setSelectedModel(exists ? defaultModel : data.models[0].id);
          }
        }).catch(() => {});
      });
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('approval:request', (data: ApprovalRequest) => {
        setApproval(data);
      });
      return () => {
        socket.off('approval:request');
      };
    }
  }, [socket]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBottom(distFromBottom > 100);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    send(text, selectedModel);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleApproval = (approved: boolean) => {
    if (socket && approval) {
      socket.emit('approval:respond', { id: approval.id, approved });
    }
    setApproval(null);
  };

  return (
    <div className="flex flex-col h-full">
      <StepProgressBar currentStep={currentStep} totalSteps={totalSteps} isStreaming={isStreaming} currentToolName={currentToolName} />

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="h-14 w-14 rounded-2xl bg-zinc-800/80 border border-zinc-700/40 flex items-center justify-center mb-5">
                <Sparkles className="h-7 w-7 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-2">Web Agent</h2>
              <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">
                Describe a task and the agent will execute it autonomously. It can read, write, search files, run commands, and more.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.timestamp ?? i}
              role={msg.isUser ? 'user' : 'assistant'}
              content={msg.content}
              toolCalls={msg.toolCalls}
              isStreaming={isStreaming && i === messages.length - 1 && !msg.isUser}
            />
          ))}
          {isStreaming && messages.length > 0 && !messages[messages.length - 1].content && (!messages[messages.length - 1].toolCalls || messages[messages.length - 1].toolCalls!.length === 0) && (
            <TypingIndicator toolName={currentToolName} />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-6 h-8 w-8 rounded-full bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shadow-lg hover:bg-zinc-700 transition-colors z-10 backdrop-blur-sm"
        >
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </button>
      )}

      {/* Input area */}
      <div className="border-t border-zinc-800/60 bg-zinc-950/50 backdrop-blur-md">
        <div className="max-w-3xl mx-auto p-3">
          <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 focus-within:ring-1 focus-within:ring-zinc-600 focus-within:border-zinc-700 transition-all">
            <button
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Describe a task for the agent..."
              rows={1}
              className="flex-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-zinc-600 min-h-[32px] max-h-[160px] py-1.5"
            />
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="bg-zinc-800 border border-zinc-700/50 rounded-lg px-2 py-1 text-[11px] text-zinc-400 max-w-[160px] truncate shrink-0 focus:outline-none"
              title={models.find(m => m.id === selectedModel)
                ? `${models.find(m => m.id === selectedModel)!.displayName || selectedModel} — ${models.find(m => m.id === selectedModel)?.costPerStep ?? 1} cr/step`
                : selectedModel
              }
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {(m.displayName || m.id.length > 25 ? (m.displayName || m.id.slice(0, 25) + '...') : m.id)} ({m.costPerStep ?? 1}cr/s)
                </option>
              ))}
            </select>
            {isStreaming ? (
              <Button size="icon" variant="destructive" onClick={cancel} className="shrink-0 h-8 w-8 rounded-lg">
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="icon" onClick={handleSend} disabled={!input.trim()} className="shrink-0 h-8 w-8 rounded-lg">
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Approval dialog */}
      {approval && (
        <ApprovalDialog request={approval} onRespond={handleApproval} />
      )}
    </div>
  );
}
