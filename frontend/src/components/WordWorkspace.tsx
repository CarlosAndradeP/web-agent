import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Download, FilePlus2, FileText, FolderOpen, LayoutTemplate, Loader2, Maximize2, MessageSquareText, Minimize2, Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import ChatPanel from './ChatPanel';
import OnlyOfficeEditor from './OnlyOfficeEditor';
import { Button } from './ui/button';
import { api } from '../lib/api';
import type { ModelInfo, WordFile, WordWorkspaceStatus } from '../types';
import { cn } from '../lib/utils';

interface Props {
  onStreamingChange?: (running: boolean) => void;
  onCreditsRequired?: () => void;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function WordWorkspace({ onStreamingChange, onCreditsRequired }: Props) {
  const [status, setStatus] = useState<WordWorkspaceStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [activeDocument, setActiveDocument] = useState<string | null>(null);
  const [section, setSection] = useState<'documents' | 'templates'>('documents');
  const [mobilePane, setMobilePane] = useState<'editor' | 'agent'>('editor');
  const [newName, setNewName] = useState('Novo documento.docx');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editorMaximized, setEditorMaximized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const documentUploadRef = useRef<HTMLInputElement>(null);
  const templateUploadRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (preserveSelection = true) => {
    const next = await api.word.status();
    setStatus(next);
    setSelectedModel(next.workspace?.model || '');
    if (!preserveSelection || !activeDocument || !next.documents.some(file => file.path === activeDocument)) {
      setActiveDocument(next.documents[0]?.path || null);
    }
    return next;
  }, [activeDocument]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.word.status(), api.models.list()])
      .then(([workspace, modelData]) => {
        if (cancelled) return;
        setStatus(workspace);
        setModels(modelData.models);
        setSelectedModel(workspace.workspace?.model || modelData.models[0]?.id || '');
        setActiveDocument(workspace.documents[0]?.path || null);
      })
      .catch((reason: Error) => !cancelled && setError(reason.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!editorMaximized) return;

    const previousOverflow = document.body.style.overflow;
    const restoreEditor = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorMaximized(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', restoreEditor);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', restoreEditor);
    };
  }, [editorMaximized]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh(false);
    } catch (reason: any) {
      setError(reason.message || 'Não foi possível concluir a ação');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleSetup = () => runAction(async () => {
    if (!selectedModel) throw new Error('Escolha um modelo de IA');
    await api.word.setup(selectedModel);
  });

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    api.word.setup(model).then(({ workspace }) => {
      setStatus(current => current ? { ...current, workspace, configured: true } : current);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const handleEditorSaved = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = () => runAction(async () => {
    const result = await api.word.createDocument(newName, selectedTemplate || undefined);
    setShowCreate(false);
    setNewName('Novo documento.docx');
    setSelectedTemplate('');
    setActiveDocument(result.path);
  });

  const handleUpload = (kind: 'documents' | 'templates', files: FileList | null) => {
    if (!files?.length) return;
    runAction(() => api.word.upload(kind, Array.from(files)));
  };

  const handleDelete = (file: WordFile) => {
    if (!confirm(`Excluir "${file.name}"?`)) return;
    runAction(() => api.word.delete(file.path));
  };

  const handleDownload = async (file: WordFile) => {
    try {
      const blob = await api.word.download(file.path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason: any) {
      setError(reason.message);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-400" /></div>;
  }

  if (!status) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-red-400">{error || 'Não foi possível carregar o workspace Word.'}</div>;
  }

  if (!status.configured) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/10 to-zinc-900/70 p-8 shadow-2xl shadow-blue-950/20">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/15"><FileText className="h-7 w-7 text-blue-300" /></div>
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">Workspace especializado</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Word + agente de documentos</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Crie, edite e revise documentos Office completos. Seus arquivos ficam isolados em <span className="font-mono text-zinc-300">Word/</span>, com documentos e modelos reutilizáveis.</p>
          </div>
          <label className="mt-7 block text-xs font-medium text-zinc-300" htmlFor="word-model">Qual modelo de IA trabalhará nos documentos?</label>
          <select id="word-model" value={selectedModel} onChange={event => setSelectedModel(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm text-zinc-200 outline-none focus:border-blue-500">
            {models.map(model => <option key={model.id} value={model.id}>{model.displayName || model.name || model.id} · {model.costPerStep ?? 1} cr/etapa</option>)}
          </select>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          <Button onClick={handleSetup} disabled={busy || !selectedModel} className="mt-5 h-12 w-full rounded-xl">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Criar workspace Word
          </Button>
        </div>
      </div>
    );
  }

  const visibleFiles = section === 'documents' ? status.documents : status.templates;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/15"><FileText className="h-4 w-4 text-blue-400" /></div>
          <span className="truncate text-sm font-semibold">Word</span>
          <span className="hidden sm:inline text-[11px] text-zinc-600">Word/Documentos</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status.documents.length > 0 && (
            <select value={activeDocument || ''} onChange={event => setActiveDocument(event.target.value)} className="h-8 max-w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none sm:max-w-52 md:hidden" aria-label="Documento aberto">
              {status.documents.map(file => <option key={file.path} value={file.path}>{file.name}</option>)}
            </select>
          )}
          <div className="flex xl:hidden rounded-lg border border-zinc-800 p-0.5">
            <button onClick={() => setMobilePane('editor')} className={cn('rounded-md px-2.5 py-1 text-xs', mobilePane === 'editor' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500')}><FileText className="mr-1 inline h-3 w-3" />Editor</button>
            <button onClick={() => setMobilePane('agent')} className={cn('rounded-md px-2.5 py-1 text-xs', mobilePane === 'agent' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500')}><Bot className="mr-1 inline h-3 w-3" />Agente</button>
          </div>
          <Button variant="ghost" size="icon" onClick={() => documentUploadRef.current?.click()} className="h-8 w-8 md:hidden" aria-label="Enviar documento"><Upload className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" onClick={() => templateUploadRef.current?.click()} className="h-8 w-8 md:hidden" aria-label="Adicionar modelo"><LayoutTemplate className="h-3.5 w-3.5" /></Button>
          {activeDocument && (
            <Button variant="ghost" size="icon" onClick={() => setEditorMaximized(true)} className="h-8 w-8" aria-label="Maximizar editor" title="Maximizar editor">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refresh()} disabled={busy} className="h-8 w-8" aria-label="Atualizar documentos"><RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /></Button>
          <Button onClick={() => setShowCreate(true)} size="sm" className="h-8 rounded-lg text-xs"><Plus className="mr-1 h-3.5 w-3.5" />Novo</Button>
        </div>
      </div>

      {error && <div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_380px]">
        <aside className={cn('min-h-0 border-r border-zinc-800 bg-zinc-900/45 md:flex md:flex-col', mobilePane === 'agent' ? 'hidden' : 'hidden md:flex')}>
          <div className="grid grid-cols-2 gap-1 p-2">
            <button onClick={() => setSection('documents')} className={cn('rounded-lg px-2 py-2 text-xs font-medium', section === 'documents' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300')}><FolderOpen className="mr-1.5 inline h-3.5 w-3.5" />Documentos</button>
            <button onClick={() => setSection('templates')} className={cn('rounded-lg px-2 py-2 text-xs font-medium', section === 'templates' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300')}><LayoutTemplate className="mr-1.5 inline h-3.5 w-3.5" />Modelos</button>
          </div>
          <div className="px-2 pb-2">
            <button onClick={() => (section === 'documents' ? documentUploadRef : templateUploadRef).current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 hover:border-blue-500/50 hover:text-blue-400"><Upload className="h-3.5 w-3.5" />{section === 'documents' ? 'Adicionar documento' : 'Adicionar modelo'}</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {visibleFiles.map(file => (
              <div key={file.path} className={cn('group mb-1 flex items-center rounded-xl border transition-colors', activeDocument === file.path ? 'border-blue-500/30 bg-blue-500/10' : 'border-transparent hover:bg-zinc-800/70')}>
                <button onClick={() => { if (file.kind === 'document') setActiveDocument(file.path); }} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                  <div className="flex items-center gap-2"><FileText className={cn('h-4 w-4 shrink-0', file.kind === 'template' ? 'text-violet-400' : 'text-blue-400')} /><span className="truncate text-xs font-medium text-zinc-200">{file.name}</span></div>
                  <div className="mt-1 pl-6 text-[10px] text-zinc-600">{formatBytes(file.size)}</div>
                </button>
                <button onClick={() => handleDownload(file)} className="hidden h-8 w-8 items-center justify-center text-zinc-500 hover:text-zinc-200 group-hover:flex" title="Baixar"><Download className="h-3.5 w-3.5" /></button>
                <button onClick={() => handleDelete(file)} className="hidden h-8 w-8 items-center justify-center text-zinc-500 hover:text-red-400 group-hover:flex" title="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {!visibleFiles.length && <div className="px-4 py-10 text-center text-xs text-zinc-600">Nenhum {section === 'documents' ? 'documento' : 'modelo'} ainda.</div>}
          </div>
        </aside>

        <section className={cn(
          'relative min-h-0 bg-zinc-950',
          mobilePane === 'agent' && !editorMaximized && 'hidden xl:block',
          editorMaximized && 'fixed inset-0 z-[100] h-dvh w-screen',
        )}>
          {activeDocument ? (
            <>
              <OnlyOfficeEditor key={activeDocument} path={activeDocument} onSaved={handleEditorSaved} />
              {editorMaximized && (
                <button
                  type="button"
                  onClick={() => setEditorMaximized(false)}
                  className="absolute right-3 top-3 z-[110] flex h-9 items-center gap-2 rounded-lg border border-zinc-600/80 bg-zinc-900/95 px-3 text-xs font-medium text-zinc-100 shadow-xl backdrop-blur hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label="Restaurar editor"
                  title="Restaurar editor (Esc)"
                >
                  <Minimize2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Restaurar</span>
                </button>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div><FilePlus2 className="mx-auto h-10 w-10 text-zinc-800" /><h3 className="mt-3 text-sm font-medium text-zinc-300">Crie ou envie um documento</h3><p className="mt-1 text-xs text-zinc-600">O editor completo aparecerá aqui.</p><Button onClick={() => setShowCreate(true)} size="sm" className="mt-4">Novo documento</Button></div>
            </div>
          )}
        </section>

        <aside className={cn('min-h-0 border-l border-zinc-800 bg-zinc-950 xl:block', mobilePane === 'editor' ? 'hidden xl:block' : 'block')}>
          <div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3 text-xs font-medium text-zinc-300"><MessageSquareText className="h-3.5 w-3.5 text-blue-400" />Agente de documentos</div>
          <div className="h-[calc(100%-2.5rem)] min-h-0">
            <ChatPanel sessionId={status.workspace!.sessionId} basePath="Word/Documentos" workspaceRootPath="Word" initialModel={status.workspace!.model} onModelChange={handleModelChange} onStreamingChange={onStreamingChange} onCreditsRequired={onCreditsRequired} />
          </div>
        </aside>
      </div>

      <input ref={documentUploadRef} type="file" multiple accept=".docx,.docm,.dotx,.dotm" className="hidden" onChange={event => { handleUpload('documents', event.target.files); event.target.value = ''; }} />
      <input ref={templateUploadRef} type="file" multiple accept=".docx,.docm,.dotx,.dotm" className="hidden" onChange={event => { handleUpload('templates', event.target.files); event.target.value = ''; }} />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={event => event.target === event.currentTarget && setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
            <h3 className="text-base font-semibold">Novo documento Word</h3>
            <p className="mt-1 text-xs text-zinc-500">Comece em branco ou use um modelo adicionado ao workspace.</p>
            <label className="mt-5 block text-xs text-zinc-400">Nome do arquivo</label>
            <input value={newName} onChange={event => setNewName(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-blue-500" autoFocus />
            <label className="mt-4 block text-xs text-zinc-400">Modelo</label>
            <select value={selectedTemplate} onChange={event => setSelectedTemplate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-blue-500">
              <option value="">Documento em branco</option>
              {status.templates.map(template => <option key={template.path} value={template.path}>{template.name}</option>)}
            </select>
            <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button onClick={handleCreate} disabled={busy || !newName.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar e abrir</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
