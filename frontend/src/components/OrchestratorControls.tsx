import { useState, useRef, useCallback, DragEvent } from 'react';
import type { OrchestratorStatusInfo } from '../types';
import { Play, Pause, Square, Upload, BrainCircuit, Shield, FileCode, Code, Eye, FileText, X, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface Props {
  status: OrchestratorStatusInfo | null;
  isLoading: boolean;
  onStart: (objective: string, mdFiles?: File[]) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onUploadMd: (files: File[]) => void;
}

const AGENT_BADGES = [
  { role: 'orchestrator', label: 'GLM-5.2', icon: BrainCircuit, color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  { role: 'auxiliar', label: 'Nemotron', icon: Shield, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  { role: 'arquiteto', label: 'GLM-5.2', icon: FileCode, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { role: 'programador', label: 'DeepSeek', icon: Code, color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  { role: 'revisor', label: 'GLM-5.2', icon: Eye, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
];

const OBJECTIVE_TEMPLATES = [
  'Criar uma landing page para um SaaS com hero, benefícios, preços e FAQ',
  'Criar uma API REST em Node.js com autenticação, CRUD e persistência em SQLite',
  'Criar um site de portfólio com grade de projetos, sobre e formulário de contato',
  'Criar um app de tarefas com localStorage, filtros e alternância de tema escuro',
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function OrchestratorControls({ status, isLoading, onStart, onStop, onPause, onResume, onUploadMd }: Props) {
  const [objective, setObjective] = useState('');
  const [pendingMdFiles, setPendingMdFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);
  const isRunning = status?.isRunning ?? false;
  const isPaused = status?.session?.status === 'paused';

  const handleStart = () => {
    if (!objective.trim()) return;
    onStart(objective.trim(), pendingMdFiles.length > 0 ? pendingMdFiles : undefined);
    setPendingMdFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isRunning && objective.trim()) {
      e.preventDefault();
      handleStart();
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files).filter(f => f.name.endsWith('.md'));
      if (isRunning || isPaused) {
        onUploadMd(fileArray);
      } else {
        setPendingMdFiles(prev => [...prev, ...fileArray]);
      }
    }
    e.target.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingMdFiles(prev => prev.filter((_, i) => i !== index));
  };

  const useTemplate = (template: string) => {
    setObjective(template);
    setShowTemplates(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(template.length, template.length);
    }
  };

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.md'));
    if (files.length === 0) return;
    if (isRunning || isPaused) {
      onUploadMd(files);
    } else {
      setPendingMdFiles(prev => [...prev, ...files]);
    }
  }, [isRunning, isPaused, onUploadMd]);

  return (
    <div
      className="relative px-3 py-3 border-t border-zinc-800/60 space-y-3"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-zinc-950/90 border-2 border-dashed border-blue-500/60 rounded flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Upload className="h-8 w-8 text-blue-400 mx-auto mb-2" />
            <p className="text-xs text-blue-300 font-medium">Solte arquivos .md para anexar como especificações</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {AGENT_BADGES.map(badge => {
          const Icon = badge.icon;
          const active = isRunning || (badge.role === 'orchestrator' && isRunning);
          return (
            <div key={badge.role} className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border',
              badge.color,
              !active && 'opacity-40'
            )}>
              <Icon className="h-3 w-3" />
              {badge.label}
            </div>
          );
        })}
      </div>

      {!isRunning && !isPaused && (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              ref={textareaRef}
              placeholder="Descreva o que você quer construir..."
              value={objective}
              onChange={e => {
                setObjective(e.target.value);
                if (textareaRef.current) {
                  textareaRef.current.style.height = 'auto';
                  textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
                }
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={2}
              className="w-full text-sm text-zinc-100 placeholder:text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 disabled:opacity-50"
            />
            <button
              onClick={() => setShowTemplates(s => !s)}
              className={cn(
                'absolute top-1.5 right-2 text-[10px] inline-flex items-center gap-1 px-1.5 py-1 rounded transition-colors',
                showTemplates ? 'text-blue-400 bg-blue-400/10' : 'text-zinc-500 hover:text-zinc-300'
              )}
              title="Modelos de objetivo"
            >
              <Sparkles className="h-3 w-3" />
              Modelos
            </button>
          </div>

          {showTemplates && (
            <div className="space-y-1 p-2 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-[10px] text-zinc-600 uppercase font-medium px-1 mb-1">Começos rápidos</p>
              {OBJECTIVE_TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => useTemplate(t)}
                  className="block w-full text-left text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 px-2 py-1.5 rounded transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleStart}
              disabled={isLoading || !objective.trim()}
              className="h-8 text-xs gap-1.5 flex-1"
            >
              <Play className="h-3 w-3" />
              Iniciar build autônomo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUpload}
              className="h-8 text-xs gap-1.5 text-zinc-400 shrink-0"
              title="Anexar arquivos .md de especificação"
            >
              <Upload className="h-3 w-3" />
              Especificações
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {pendingMdFiles.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-600 uppercase font-medium">Especificações anexadas ({pendingMdFiles.length})</p>
              <div className="space-y-1">
                {pendingMdFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-zinc-900 border border-zinc-800">
                    <FileText className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    <span className="text-zinc-300 truncate flex-1">{f.name}</span>
                    <span className="text-[10px] text-zinc-600 font-mono shrink-0">{formatSize(f.size)}</span>
                    <button onClick={() => removePendingFile(i)} className="text-zinc-600 hover:text-red-400 transition-colors shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-zinc-700 flex items-center gap-1">
            Solte arquivos .md aqui ou pressione
            <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] font-mono">Ctrl+Enter</kbd>
            para iniciar
          </p>
        </div>
      )}

      {(isRunning || isPaused) && (
        <div className="flex items-center gap-2">
          {isRunning && (
            <>
              <Button variant="outline" size="sm" onClick={onPause} disabled={isLoading} className="h-8 text-xs gap-1.5">
                <Pause className="h-3 w-3" />
                Pausar
              </Button>
              <Button variant="ghost" size="sm" onClick={onStop} disabled={isLoading} className="h-8 text-xs gap-1.5 text-red-400 hover:text-red-300">
                <Square className="h-3 w-3" />
                Parar
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button size="sm" onClick={onResume} disabled={isLoading} className="h-8 text-xs gap-1.5">
                <Play className="h-3 w-3" />
                Retomar
              </Button>
              <Button variant="ghost" size="sm" onClick={onStop} disabled={isLoading} className="h-8 text-xs gap-1.5 text-red-400 hover:text-red-300">
                <Square className="h-3 w-3" />
                Parar
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={handleUpload} className="h-8 text-xs gap-1.5 text-zinc-400 ml-auto">
            <Upload className="h-3 w-3" />
            Adicionar especificações
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
}
