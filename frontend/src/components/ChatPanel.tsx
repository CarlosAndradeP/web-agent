import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import type { ModelInfo, ApprovalRequest } from '../types';
import MessageBubble from './MessageBubble';
import ApprovalDialog from './ApprovalDialog';
import StepProgressBar from './StepProgressBar';
import TypingIndicator from './TypingIndicator';
import { Button } from './ui/button';
import { Send, Square, Paperclip, ChevronDown, Globe, Sparkles, X, Upload, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
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
  onCreditsRequired?: () => void;
  basePath?: string;
  workspaceRootPath?: string;
  initialModel?: string;
  onModelChange?: (model: string) => void;
  workspaceProfile?: 'development' | 'word';
}

export default function ChatPanel({ sessionId, onStreamingChange, onNewSession, onCreditsRequired, basePath, workspaceRootPath, initialModel, onModelChange, workspaceProfile = 'development' }: Props) {
  const { messages, send, cancel, isStreaming, status, isLoadingHistory, historyError, reloadHistory, currentStep, totalSteps, currentToolName, addSystemMessage, addAttachedFiles, clearChat } = useChat(sessionId, { onCreditsRequired });
  const { socket } = useSocket();

  // Notify parent layout about streaming state changes
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [defaultMaxSteps, setDefaultMaxSteps] = useState(100);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [customMaxSteps, setCustomMaxSteps] = useState<number | undefined>(undefined);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showCommands, setShowCommands] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const isWordWorkspace = workspaceProfile === 'word';

  // Filter slash commands based on current input
  const filteredCommands = input.startsWith('/')
    ? SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(input.split(' ')[0]))
    : [];

  useEffect(() => {
    setShowCommands(input.startsWith('/') && !input.includes(' ') && filteredCommands.length > 0);
  }, [input]);

  const loadModels = useCallback(() => {
    setIsLoadingModels(true);
    setModelsError(null);
    let defaultModel = '';
    api.config.get()
      .then(cfg => {
        defaultModel = cfg.defaultModel;
        setDefaultMaxSteps(cfg.maxSteps);
      })
      .catch(() => {})
      .finally(() => {
        api.models.list().then(data => {
          setModels(data.models);
          if (data.models.length > 0) {
            const preferred = initialModel || defaultModel;
            const exists = preferred && data.models.find(m => m.id === preferred);
            setSelectedModel(exists ? preferred : data.models[0].id);
          }
          if (data.models.length === 0) setModelsError('Nenhum modelo disponível.');
        }).catch((err: Error) => {
          setModelsError(err.message || 'Não foi possível carregar os modelos.');
        }).finally(() => setIsLoadingModels(false));
      });
  }, [initialModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

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
    isNearBottomRef.current = true;
    setShowScrollBottom(false);
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const timer = setTimeout(() => {
      const el = scrollRef.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isNearBottom = distFromBottom <= 100;
      isNearBottomRef.current = isNearBottom;
      setShowScrollBottom(!isNearBottom);
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
          onModelChange?.(match.id);
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
  }, [clearChat, onNewSession, sessionId, addSystemMessage, selectedModel, models, customMaxSteps, onModelChange]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming || isLoadingHistory || (!text.startsWith('/') && !selectedModel)) return;
    isNearBottomRef.current = true;
    setShowScrollBottom(false);
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
    send(text, selectedModel, customMaxSteps ?? defaultMaxSteps);
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
    if (isStreaming) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsUploading(true);
    try {
      const result = await api.files.upload(fileArray, basePath || '.');
      if (result.uploaded && result.uploaded.length > 0) {
        const scopedRoot = (workspaceRootPath || basePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
        const scopedUploads = result.uploaded.map(path => {
          const normalized = path.replace(/\\/g, '/');
          return scopedRoot && normalized.startsWith(`${scopedRoot}/`) ? normalized.slice(scopedRoot.length + 1) : normalized;
        });
        setAttachedFiles(prev => [...prev, ...scopedUploads]);
        addSystemMessage(`Arquivos enviados: ${scopedUploads.join(', ')}`);
      }
    } catch (err: any) {
      addSystemMessage(`Falha no upload: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }, [basePath, workspaceRootPath, addSystemMessage, isStreaming]);

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
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <StepProgressBar currentStep={currentStep} totalSteps={totalSteps} status={approval ? 'awaiting_approval' : status} currentToolName={currentToolName} />
      <div className="sr-only" role="status" aria-live="polite">
        {approval ? 'O agente aguarda sua aprovação.' : status === 'completed' ? 'Tarefa concluída.' : status === 'error' ? 'A tarefa falhou.' : status === 'cancelled' ? 'Tarefa interrompida.' : status === 'running' ? 'Agente em execução.' : ''}
      </div>

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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} role="log" aria-label="Conversa com o agente" aria-busy={isStreaming}>
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-6 sm:py-10 space-y-5">
          {isLoadingHistory && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              <p className="text-xs">Carregando conversa...</p>
            </div>
          )}
          {!isLoadingHistory && historyError && (
            <div className="mx-auto flex min-h-[40vh] max-w-sm flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <p className="text-sm font-medium text-zinc-200">Não foi possível carregar a conversa</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{historyError}</p>
              <Button variant="outline" size="sm" onClick={reloadHistory} className="mt-4 gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
          )}
          {!isLoadingHistory && !historyError && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[55vh] text-center">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 shadow-lg shadow-blue-950/20 flex items-center justify-center mb-6">
                <Sparkles className="h-7 w-7 text-blue-300" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-100 mb-2">{isWordWorkspace ? 'Qual documento vamos preparar?' : 'O que vamos construir hoje?'}</h2>
              <p className="text-sm text-zinc-400 max-w-lg leading-relaxed">
                {isWordWorkspace
                  ? 'Descreva o documento, a revisão ou a formatação desejada. O agente trabalha exclusivamente em arquivos Word e valida o resultado.'
                  : 'Descreva uma tarefa e o agente executará de forma autônoma. Ele pode ler, escrever e pesquisar arquivos, rodar comandos e revisar o resultado.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg mt-7">
                {(isWordWorkspace
                  ? ['Crie um relatório profissional em Word', 'Revise e padronize um documento existente']
                  : ['Analise este projeto e sugira melhorias', 'Crie uma nova página responsiva']).map(suggestion => (
                  <button key={suggestion} onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left text-sm text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200 transition-colors">
                    {suggestion}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-4">Use <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">/help</code> para ver todos os comandos</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              role={msg.isUser ? 'user' : (msg.role === 'system' ? 'system' : 'assistant')}
              content={msg.content}
              toolCalls={msg.toolCalls}
              isStreaming={isStreaming && i === messages.length - 1 && !msg.isUser}
              createdFiles={msg.createdFiles}
              createdFileCount={msg.createdFileCount}
              basePath={basePath}
            />
          ))}
          {isStreaming && messages.length > 0 && !messages[messages.length - 1].content && (!messages[messages.length - 1].toolCalls || messages[messages.length - 1].toolCalls!.length === 0) && (
            <TypingIndicator toolName={currentToolName} />
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-36 sm:bottom-28 right-4 sm:right-8 h-10 w-10 rounded-full bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shadow-lg hover:bg-zinc-700 transition-colors z-10 backdrop-blur-sm"
          aria-label="Ir para a mensagem mais recente"
        >
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </button>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-800/70 bg-zinc-950/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto px-3 py-3 sm:px-6 sm:py-4">
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map(file => (
                <div key={file} className="flex items-center gap-1 px-2 py-1 bg-zinc-800 border border-zinc-700/50 rounded-md text-xs text-zinc-300">
                  <Paperclip className="h-3 w-3 text-zinc-500" />
                  <span className="truncate max-w-[150px]">{file}</span>
                  <button onClick={() => removeAttachedFile(file)} className="ml-1 text-zinc-500 hover:text-zinc-300" aria-label={`Remover anexo ${file}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="bg-zinc-900/90 border border-zinc-700/70 rounded-2xl p-2 shadow-xl shadow-black/20 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500/50 transition-all relative">
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
            <div className="flex items-end gap-2">
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploading || isStreaming} className="shrink-0 h-10 w-10 flex items-center justify-center rounded-xl hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-200 disabled:opacity-50" title="Anexar arquivo" aria-label={isUploading ? 'Enviando arquivo' : 'Anexar arquivo'}>
                {isUploading ? <div className="h-4 w-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
              <textarea ref={textareaRef} value={input} onChange={handleTextareaChange} onKeyDown={handleKeyDown} placeholder={modelsError ? 'Modelos indisponíveis no momento' : (isWordWorkspace ? 'Descreva o documento ou a alteração desejada...' : 'Descreva o que você quer criar ou modificar...')} rows={1} aria-label="Mensagem para o agente" aria-autocomplete="list" aria-controls={showCommands ? 'slash-command-list' : undefined} aria-activedescendant={showCommands ? `slash-command-${commandIndex}` : undefined} className="flex-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-zinc-600 min-h-10 max-h-[160px] py-2.5 leading-5" />
              {isStreaming ? (
                <Button size="icon" variant="destructive" onClick={cancel} className="shrink-0 h-10 w-10 rounded-xl" aria-label="Interromper agente"><Square className="h-3.5 w-3.5" /></Button>
              ) : (
                <Button size="icon" onClick={handleSend} disabled={!input.trim() || !selectedModel || isLoadingModels || isLoadingHistory} className="shrink-0 h-10 w-10 rounded-xl" aria-label="Enviar mensagem"><Send className="h-4 w-4" /></Button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-1 pt-2 mt-1 border-t border-zinc-800/80">
              <label className="flex items-center gap-1.5 min-w-0 text-xs text-zinc-500">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="sr-only">Modelo</span>
                <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); onModelChange?.(e.target.value); }} disabled={isLoadingModels || !!modelsError} className="bg-transparent max-w-[210px] sm:max-w-xs truncate text-xs text-zinc-400 focus:outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" title={models.find(m => m.id === selectedModel) ? `${models.find(m => m.id === selectedModel)!.displayName || selectedModel} - ${models.find(m => m.id === selectedModel)?.costPerStep ?? 1} cr/etapa` : selectedModel}>
                  {isLoadingModels && <option value="">Carregando modelos...</option>}
                  {modelsError && <option value="">Modelos indisponíveis</option>}
                  {models.map(m => <option key={m.id} value={m.id}>{m.displayName || m.id} ({m.costPerStep ?? 1} cr/etapa)</option>)}
                </select>
              </label>
              {modelsError && <button type="button" onClick={loadModels} className="text-[11px] text-red-400 hover:text-red-300">Tentar novamente</button>}
              <span className="hidden sm:block text-[11px] text-zinc-600">Enter envia · Shift + Enter quebra linha</span>
            </div>

            {/* Slash command autocomplete dropdown */}
            {showCommands && filteredCommands.length > 0 && (
              <div id="slash-command-list" className="absolute bottom-full left-0 right-0 mb-2 bg-zinc-900 border border-zinc-700/70 rounded-xl shadow-2xl overflow-hidden z-20" role="listbox" aria-label="Comandos disponíveis">
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.name}
                    id={`slash-command-${i}`}
                    role="option"
                    aria-selected={i === commandIndex}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800 transition-colors',
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
                    <span className="text-xs text-zinc-400">{cmd.description}</span>
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
