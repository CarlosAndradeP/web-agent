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
import { Send, Square, Paperclip, ChevronDown, Globe, Sparkles, X, Upload } from 'lucide-react';
import { cn } from '../lib/utils';

interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/clear', description: 'Limpar mensagens do chat' },
  { name: '/new', description: 'Iniciar uma nova sessão' },
  { name: '/compact', description: 'Compactar o contexto da conversa' },
  { name: '/help', description: 'Mostrar comandos disponíveis' },
  { name: '/model', description: 'Trocar modelo', usage: '/model <nome>' },
  { name: '/steps', description: 'Definir limite de etapas do agente', usage: '/steps <número>' },
];

interface Props {
  sessionId: string;
  onStreamingChange?: (isStreaming: boolean) => void;
  onNewSession?: () => void;
  basePath?: string;
}

export default function ChatPanel({ sessionId, onStreamingChange, onNewSession, basePath }: Props) {
  const { messages, send, cancel, isStreaming, currentStep, totalSteps, currentToolName, addSystemMessage, addAttachedFiles, clearChat } = useChat(sessionId);
  const { socket } = useSocket();

  // Notify parent layout about streaming state changes
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [customMaxSteps, setCustomMaxSteps] = useState<number | undefined>(undefined);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showCommands, setShowCommands] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter slash commands based on current input
  const filteredCommands = input.startsWith('/')
    ? SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(input.split(' ')[0]))
    : [];

  useEffect(() => {
    setShowCommands(input.startsWith('/') && !input.includes(' ') && filteredCommands.length > 0);
  }, [input]);

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

  const executeCommand = useCallback((command: string): boolean => {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/clear':
        clearChat();
        setAttachedFiles([]);
        addSystemMessage('Chat limpo.');
        return true;

      case '/new':
        onNewSession?.();
        addSystemMessage('Nova sessão iniciada.');
        return true;

      case '/compact':
        addSystemMessage('Compactando o contexto da conversa...');
        api.chat.compact(sessionId).then((result: any) => {
          addSystemMessage(result?.summary ? `Contexto compactado. Resumo: ${result.summary.slice(0, 200)}...` : 'Contexto compactado.');
        }).catch((err: any) => {
          addSystemMessage(`Falha ao compactar: ${err.message}`);
        });
        return true;

      case '/help':
        addSystemMessage(
          '**Comandos disponíveis:**\n\n' +
          SLASH_COMMANDS.map(c => `- \`${c.usage || c.name}\`: ${c.description}`).join('\n')
        );
        return true;

      case '/model':
        if (args.length === 0) {
          addSystemMessage(`Modelo atual: \`${selectedModel}\`\n\nDisponíveis: ${models.map(m => `\`${m.id}\``).join(', ')}`);
          return true;
        }
        const modelQuery = args.join(' ').toLowerCase();
        const match = models.find(m => m.id.toLowerCase() === modelQuery || m.id.toLowerCase().includes(modelQuery));
        if (match) {
          setSelectedModel(match.id);
          addSystemMessage(`Modelo alterado para \`${match.id}\`.`);
        } else {
          addSystemMessage(`Modelo não encontrado. Disponíveis: ${models.map(m => `\`${m.id}\``).join(', ')}`);
        }
        return true;

      case '/steps':
        if (args.length === 0) {
          addSystemMessage(`Limite atual de etapas: \`${customMaxSteps ?? 'padrão'}\``);
          return true;
        }
        const stepsValue = parseInt(args[0], 10);
        if (isNaN(stepsValue) || stepsValue < 1 || stepsValue > 200) {
          addSystemMessage('O limite de etapas deve ser um número entre 1 e 200.');
          return true;
        }
        setCustomMaxSteps(stepsValue);
        addSystemMessage(`Limite de etapas definido como \`${stepsValue}\`.`);
        return true;

      default:
        addSystemMessage(`Comando desconhecido: \`${cmd}\`. Digite \`/help\` para ver os comandos disponíveis.`);
        return true;
    }
  }, [clearChat, onNewSession, sessionId, addSystemMessage, selectedModel, models, customMaxSteps]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');

    // Check for slash commands
    if (text.startsWith('/')) {
      // Execute even unknown commands so the user gets a helpful message.
      executeCommand(text);
      return;
    }

    // Add any attached files to the useChat ref
    if (attachedFiles.length > 0) {
      addAttachedFiles(attachedFiles);
      setAttachedFiles([]);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    send(text, selectedModel, customMaxSteps);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash command autocomplete navigation
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const selected = filteredCommands[commandIndex];
        if (selected) {
          setInput(selected.name + ' ');
          setShowCommands(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowCommands(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setCommandIndex(0);
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

  // File attachment handlers
  const handleFileAttach = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsUploading(true);
    try {
      const result = await api.files.upload(fileArray, basePath || '.');
      if (result.uploaded && result.uploaded.length > 0) {
        setAttachedFiles(prev => [...prev, ...result.uploaded]);
        addSystemMessage(`Arquivos enviados: ${result.uploaded.join(', ')}`);
      }
    } catch (err: any) {
      addSystemMessage(`Falha no upload: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }, [basePath, addSystemMessage]);

  const removeAttachedFile = useCallback((file: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== file));
  }, []);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileAttach(e.dataTransfer.files);
    }
  }, [handleFileAttach]);

  return (
    <div className="flex flex-col h-full relative">
      <StepProgressBar currentStep={currentStep} totalSteps={totalSteps} isStreaming={isStreaming} currentToolName={currentToolName} />

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center backdrop-blur-sm">
          <div className="text-center">
            <Upload className="h-10 w-10 text-blue-400 mx-auto mb-2" />
            <p className="text-blue-300 font-medium">Solte os arquivos para enviar</p>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="h-14 w-14 rounded-2xl bg-zinc-800/80 border border-zinc-700/40 flex items-center justify-center mb-5">
                <Sparkles className="h-7 w-7 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-2">O que vamos construir hoje?</h2>
              <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">
                Descreva uma tarefa e o agente executará de forma autônoma. Ele pode ler, escrever e pesquisar arquivos, rodar comandos e revisar o resultado.
              </p>
              <p className="text-xs text-zinc-600 mt-3">Digite <code className="text-zinc-400">/help</code> para ver os comandos</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.timestamp ?? i}
              role={msg.isUser ? 'user' : (msg.role === 'system' ? 'system' : 'assistant')}
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
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map(file => (
                <div key={file} className="flex items-center gap-1 px-2 py-1 bg-zinc-800 border border-zinc-700/50 rounded-md text-xs text-zinc-300">
                  <Paperclip className="h-3 w-3 text-zinc-500" />
                  <span className="truncate max-w-[150px]">{file}</span>
                  <button onClick={() => removeAttachedFile(file)} className="ml-1 text-zinc-500 hover:text-zinc-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 focus-within:ring-1 focus-within:ring-zinc-600 focus-within:border-zinc-700 transition-all relative">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileAttach(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              title="Anexar arquivo"
            >
              {isUploading ? (
                <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Descreva uma tarefa para o agente..."
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
                  {(m.displayName || m.id.length > 25 ? (m.displayName || m.id.slice(0, 25) + '...') : m.id)} ({m.costPerStep ?? 1} cr/etapa)
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

            {/* Slash command autocomplete dropdown */}
            {showCommands && filteredCommands.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl overflow-hidden z-20">
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.name}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800 transition-colors',
                      i === commandIndex && 'bg-zinc-800'
                    )}
                    onClick={() => {
                      setInput(cmd.name + ' ');
                      setShowCommands(false);
                      textareaRef.current?.focus();
                    }}
                    onMouseEnter={() => setCommandIndex(i)}
                  >
                    <span className="text-sm font-mono text-blue-400">{cmd.name}</span>
                    <span className="text-xs text-zinc-500">{cmd.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom steps indicator */}
          {customMaxSteps !== undefined && (
            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-zinc-600">
              <span>Limite de etapas: {customMaxSteps}</span>
              <button onClick={() => { setCustomMaxSteps(undefined); addSystemMessage('Limite de etapas restaurado para o padrão.'); }} className="text-zinc-500 hover:text-zinc-300 ml-1">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Approval dialog */}
      {approval && (
        <ApprovalDialog request={approval} onRespond={handleApproval} />
      )}
    </div>
  );
}
