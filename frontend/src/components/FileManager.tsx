import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useFiles } from '../hooks/useFiles';
import { useResizable } from '../hooks/useResizable';
import { api } from '../lib/api';
import type { FileEntry } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import PublishProjectDialog from './PublishProjectDialog';
import {
  FolderOpen,
  File,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  FileEdit,
  Save,
  X,
  ChevronRight,
  ChevronDown,
  Folder,
  FilePlus,
  FolderPlus,
  Globe,
  Pencil,
  ArrowLeft,
  Archive,
  PackageOpen,
  Search,
  AlertCircle,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
} from 'lucide-react';
import { cn } from '../lib/utils';

type ViewMode = 'view' | 'edit';

interface FileNodeProps {
  entry: FileEntry;
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, type: string, entry: FileEntry) => void;
  onDelete: (path: string, type: string) => void;
  onRename: (path: string, type: string) => void;
  onDownload: (path: string) => void;
  onDownloadZip: (path: string) => void;
  onNavigateInto: (path: string) => void;
}

function FileNode({ entry, path, depth, selectedPath, onSelect, onDelete, onRename, onDownload, onDownloadZip, onNavigateInto }: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isDir = entry.type === 'directory';
  const isSelected = selectedPath === path;

  return (
    <div>
      <div
        className={cn(
          'group relative mx-1 flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border py-1.5 pr-1.5 text-sm transition-all',
          isSelected
            ? 'border-blue-500/20 bg-blue-500/10 text-zinc-100 shadow-sm shadow-blue-950/10'
            : 'border-transparent text-zinc-400 hover:border-zinc-800/80 hover:bg-zinc-800/40 hover:text-zinc-200'
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          onSelect(path, entry.type, entry);
        }}
        onDoubleClick={() => {
          if (isDir) onNavigateInto(path);
        }}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-expanded={isDir ? expanded : undefined}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (isDir) setExpanded(!expanded);
            onSelect(path, entry.type, entry);
          }
        }}
      >
        {isDir ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          expanded ? <FolderOpen className="h-4 w-4 shrink-0 text-blue-400/80" /> : <Folder className="h-4 w-4 shrink-0 text-blue-400/60" />
        ) : (
          <File className="h-4 w-4 shrink-0 text-zinc-500" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{entry.name}</span>
          <span className="block truncate text-[10px] text-zinc-600">
            {isDir ? 'Pasta' : formatFileSize(entry.size)}
          </span>
        </span>
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700/80 hover:text-zinc-100 focus-visible:text-zinc-100',
                  isSelected ? 'bg-zinc-800/70 text-zinc-300' : 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
                )}
                title={`Ações de ${entry.name}`}
                aria-label={`Abrir ações de ${entry.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" sideOffset={8}>
              <DropdownMenuLabel className="max-w-52 truncate">{entry.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onRename(path, entry.type)}>
                <Pencil /> Renomear
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => isDir ? onDownloadZip(path) : onDownload(path)}>
                {isDir ? <Archive /> : <Download />}
                {isDir ? 'Baixar como ZIP' : 'Baixar arquivo'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDelete(path, entry.type)} className="text-red-300 focus:bg-red-500/10 focus:text-red-200">
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isDir && expanded && entry.children && entry.children.map(child => (
        <FileNode
          key={path + '/' + child.name}
          entry={child}
          path={path + '/' + child.name}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
          onDownload={onDownload}
          onDownloadZip={onDownloadZip}
          onNavigateInto={onNavigateInto}
        />
      ))}
    </div>
  );
}

export default function FileManager({ basePath = '.' }: { basePath?: string }) {
  const [currentPath, setCurrentPath] = useState<string>(basePath);
  const { tree, loading, error, refresh } = useFiles(currentPath);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedEditable, setSelectedEditable] = useState(true);
  const [fileContent, setFileContent] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('view');
  const [editContent, setEditContent] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder'>('file');
  const [createName, setCreateName] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePath, setDeletePath] = useState('');
  const [deleteType, setDeleteType] = useState<string>('file');
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameOldPath, setRenameOldPath] = useState('');
  const [renameNewName, setRenameNewName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const contentRequestRef = useRef<AbortController | null>(null);

  const { width: fileTreeWidth, handleMouseDown: fileTreeResize, handleDoubleClick: fileTreeReset } = useResizable({
    storageKey: 'webagent_filetree_width',
    defaultWidth: 300,
    minWidth: 240,
    maxWidth: 480,
  });

  useEffect(() => {
    contentRequestRef.current?.abort();
    setCurrentPath(basePath);
    setSelectedFile(null);
    setFileContent('');
    setEditContent('');
    setViewMode('view');
    setSearchQuery('');
    setNotice(null);
  }, [basePath]);

  useEffect(() => () => contentRequestRef.current?.abort(), []);

  const isDirty = viewMode === 'edit' && editContent !== fileContent;

  const allowDiscard = useCallback(() => {
    return !isDirty || window.confirm('Há alterações não salvas. Deseja descartá-las?');
  }, [isDirty]);

  const navigateTo = useCallback((path: string) => {
    if (!allowDiscard()) return;
    setCurrentPath(path);
    setSelectedFile(null);
    setFileContent('');
    setEditContent('');
    setViewMode('view');
    setSearchQuery('');
  }, [allowDiscard]);

  const navigateUp = useCallback(() => {
    if (currentPath === basePath) return;
    const parent = currentPath.includes('/') ? currentPath.split('/').slice(0, -1).join('/') : basePath;
    navigateTo(parent.length < basePath.length ? basePath : parent);
  }, [basePath, currentPath, navigateTo]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    const relativePath = relativeToRoot(currentPath, basePath);
    const segments = relativePath ? relativePath.split('/') : [];
    navigateTo(index === -1 ? basePath : joinPath(basePath, segments.slice(0, index + 1).join('/')));
  }, [basePath, currentPath, navigateTo]);

  const relativePath = relativeToRoot(currentPath, basePath);
  const pathSegments = relativePath ? relativePath.split('/') : [];

  const handleSelect = useCallback(async (path: string, type: string, entry: FileEntry) => {
    if (type === 'file') {
      if (!allowDiscard()) return;
      contentRequestRef.current?.abort();
      const controller = new AbortController();
      contentRequestRef.current = controller;
      setSelectedFile(path);
      setSelectedEditable(entry.editable !== false);
      setFileLoading(true);
      setNotice(null);
      try {
        if (entry.editable === false) {
          setFileContent('Este arquivo não possui visualização de texto. Use o botão de download para abri-lo localmente.');
          setEditContent('');
        } else {
          const data = await api.files.content(path, controller.signal);
          setSelectedFile(data.path);
          setFileContent(data.content);
          setEditContent(data.content);
        }
        setViewMode('view');
      } catch (requestError) {
        if (!controller.signal.aborted) setNotice({ type: 'error', text: errorMessage(requestError) });
      } finally {
        if (!controller.signal.aborted) setFileLoading(false);
      }
    }
  }, [allowDiscard]);

  const handleDownload = useCallback(async (path: string) => {
    try {
      setPendingAction(`download:${path}`);
      setNotice(null);
      const url = api.files.downloadUrl(path);
      const blob = await api.files.downloadBlob(url);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = path.split('/').pop() || 'file';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
    } catch (downloadError) {
      setNotice({ type: 'error', text: errorMessage(downloadError) });
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleDownloadZip = useCallback(async (path: string) => {
    try {
      setPendingAction(`download:${path}`);
      setNotice(null);
      const url = api.files.downloadZipUrl(path);
      const blob = await api.files.downloadBlob(url);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${path.split('/').pop() || 'folder'}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
    } catch (downloadError) {
      setNotice({ type: 'error', text: errorMessage(downloadError) });
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      setPendingAction('delete');
      setNotice(null);
      await api.files.delete(deletePath);
      setShowDeleteDialog(false);
      if (selectedFile === deletePath || selectedFile?.startsWith(deletePath + '/')) {
        setSelectedFile(null);
        setFileContent('');
      }
      setNotice({ type: 'success', text: 'Item excluído.' });
      refresh();
    } catch (deleteError) {
      setNotice({ type: 'error', text: errorMessage(deleteError) });
    } finally {
      setPendingAction(null);
    }
  }, [deletePath, selectedFile, refresh]);

  const handleRename = useCallback(async () => {
    const newName = renameNewName.trim();
    if (!newName) return;
    const parts = renameOldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    try {
      setPendingAction('rename');
      setNotice(null);
      await api.files.rename(renameOldPath, newPath);
      setShowRenameDialog(false);
      if (selectedFile === renameOldPath || selectedFile?.startsWith(renameOldPath + '/')) {
        setSelectedFile(selectedFile.replace(renameOldPath, newPath));
      }
      setRenameNewName('');
      setNotice({ type: 'success', text: 'Item renomeado.' });
      refresh();
    } catch (renameError) {
      setNotice({ type: 'error', text: errorMessage(renameError) });
    } finally {
      setPendingAction(null);
    }
  }, [renameNewName, renameOldPath, selectedFile, refresh]);

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return;
    const path = joinPath(currentPath, name);
    try {
      setPendingAction('create');
      setNotice(null);
      if (createType === 'file') {
        await api.files.createFile(path);
      } else {
        await api.files.mkdir(path);
      }
      setShowCreateDialog(false);
      setCreateName('');
      setNotice({ type: 'success', text: `${createType === 'file' ? 'Arquivo' : 'Pasta'} criado.` });
      refresh();
    } catch (createError) {
      setNotice({ type: 'error', text: errorMessage(createError) });
    } finally {
      setPendingAction(null);
    }
  }, [createName, createType, currentPath, refresh]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    try {
      setPendingAction('save');
      setNotice(null);
      await api.files.write(selectedFile, editContent);
      setFileContent(editContent);
      setViewMode('view');
      setNotice({ type: 'success', text: 'Arquivo salvo.' });
      refresh();
    } catch (saveError) {
      setNotice({ type: 'error', text: errorMessage(saveError) });
    } finally {
      setPendingAction(null);
    }
  }, [selectedFile, editContent, refresh]);

  const handleUpload = async (files: FileList) => {
    const fileArr = Array.from(files);
    const zipFiles = fileArr.filter(file => file.name.toLowerCase().endsWith('.zip'));
    const otherFiles = fileArr.filter(file => !file.name.toLowerCase().endsWith('.zip'));
    try {
      setPendingAction('upload');
      setNotice(null);
      if (otherFiles.length) await api.files.upload(otherFiles, currentPath);
      for (const file of zipFiles) await api.files.extractZip(file, currentPath);
      setNotice({ type: 'success', text: `${fileArr.length} arquivo(s) processado(s).` });
      refresh();
    } catch (uploadError) {
      setNotice({ type: 'error', text: errorMessage(uploadError) });
    } finally {
      setPendingAction(null);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleExtractZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPendingAction('upload');
      setNotice(null);
      await api.files.extractZip(file, currentPath);
      setNotice({ type: 'success', text: 'ZIP extraído.' });
      refresh();
    } catch (extractError) {
      setNotice({ type: 'error', text: errorMessage(extractError) });
    } finally {
      setPendingAction(null);
    }
    if (zipInputRef.current) zipInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && viewMode === 'edit') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleSave, viewMode]);

  const visibleTree = searchQuery.trim() ? filterTree(tree, searchQuery.trim().toLowerCase()) : tree;
  const visibleItemCount = countTree(visibleTree);

  if (loading && tree.length === 0) return <div className="flex h-full items-center justify-center gap-3 text-zinc-400 text-sm"><RefreshCw className="h-4 w-4 animate-spin" /> Carregando arquivos...</div>;

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_34rem)]" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragOver && <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500/70 bg-zinc-950/90 text-sm font-medium text-blue-300"><Upload className="mr-2 h-5 w-5" /> Solte os arquivos para enviar a {currentPath}</div>}
      {/* File tree panel */}
      <div className={cn('flex w-full min-w-0 flex-col overflow-hidden border-r border-zinc-800/70 bg-zinc-900/45 md:w-[var(--file-tree-width)] md:shrink-0', selectedFile && 'hidden md:flex')} style={{ '--file-tree-width': `${fileTreeWidth}px` } as CSSProperties}>
        {/* Toolbar */}
        <div className="border-b border-zinc-800/70 bg-zinc-900/50 px-3 pb-3 pt-4 sm:px-4">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-400"><FolderOpen className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-100">Arquivos</h2>
                <p className="truncate text-[11px] text-zinc-500">{visibleItemCount} {visibleItemCount === 1 ? 'item' : 'itens'} nesta visualização</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-zinc-400 hover:text-zinc-100" onClick={refresh} title="Atualizar" aria-label="Atualizar arquivos">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>

          <div className="mb-3 grid min-w-0 grid-cols-2 gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="min-w-0 justify-start px-2.5 text-zinc-200">
                  <Plus className="h-3.5 w-3.5 text-blue-400" /><span className="truncate">Novo</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Criar em {currentPath.split('/').pop() || 'workspace'}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => { setCreateType('file'); setShowCreateDialog(true); }}><FilePlus /> Novo arquivo</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setCreateType('folder'); setShowCreateDialog(true); }}><FolderPlus /> Nova pasta</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" className="min-w-0 justify-start px-2.5 text-zinc-200" onClick={() => uploadInputRef.current?.click()} disabled={pendingAction === 'upload'}>
              {pendingAction === 'upload' ? <Loader2 className="animate-spin text-blue-400" /> : <Upload className="text-blue-400" />}<span className="truncate">Enviar</span>
            </Button>
            <Button variant="outline" size="sm" className="min-w-0 justify-start px-2.5 text-zinc-400" onClick={() => zipInputRef.current?.click()} disabled={pendingAction === 'upload'}>
              <PackageOpen /><span className="truncate">Extrair ZIP</span>
            </Button>
            <Button variant="outline" size="sm" className="min-w-0 justify-start border-blue-500/20 bg-blue-500/5 px-2.5 text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/10" onClick={() => setShowPublishDialog(true)}>
              <Globe /><span className="truncate">Publicar</span>
            </Button>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => e.target.files && void handleUpload(e.target.files)}
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleExtractZip}
          />

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <Input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Filtrar arquivos..." className="h-8 border-zinc-800 bg-zinc-950/40 pl-8 text-xs" />
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-zinc-500 hover:text-zinc-200" onClick={navigateUp} title="Subir um nível" aria-label="Subir um nível" disabled={currentPath === basePath}>
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <div className="flex items-center gap-0.5 overflow-x-auto text-xs min-w-0 scrollbar-none">
              <button
                onClick={() => navigateTo(basePath)}
                className={cn(
                  'shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-800/60 transition-colors',
                  pathSegments.length === 0 ? 'text-zinc-200 bg-zinc-800/60' : 'text-zinc-600 hover:text-zinc-300'
                )}
              >
                 {basePath === '.' ? 'workspace' : basePath.split('/').pop()}
              </button>
              {pathSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRight className="h-2.5 w-2.5 text-zinc-700" />
                  <button
                    onClick={() => navigateToBreadcrumb(i)}
                    className={cn(
                      'px-1.5 py-0.5 rounded hover:bg-zinc-800/60 transition-colors',
                      i === pathSegments.length - 1 ? 'text-zinc-200 bg-zinc-800/60' : 'text-zinc-600 hover:text-zinc-300'
                    )}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {(notice || error) && (
          <div className={cn('mx-3 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', (notice?.type === 'error' || error) ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300')}>
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{notice?.text || error}</span>
            <button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* File tree */}
        <ScrollArea className="min-h-0 flex-1" role="tree" aria-label="Árvore de arquivos">
          <div className="space-y-0.5 py-2">
            {visibleTree.map(entry => (
              <FileNode
                key={entry.name}
                entry={entry}
                path={entry.path}
                depth={0}
                selectedPath={selectedFile}
                onSelect={handleSelect}
                onDelete={(p, type) => { setDeletePath(p); setDeleteType(type); setShowDeleteDialog(true); }}
                onRename={(p) => {
                  setRenameOldPath(p);
                  setRenameNewName(p.split('/').pop() || '');
                  setShowRenameDialog(true);
                }}
                onDownload={handleDownload}
                onDownloadZip={handleDownloadZip}
                onNavigateInto={navigateTo}
              />
            ))}
            {visibleTree.length === 0 && !error && (
              <div className="p-8 text-center"><FolderOpen className="h-8 w-8 text-zinc-800 mx-auto mb-2" /><p className="text-zinc-500 text-sm">{searchQuery ? 'Nenhum arquivo encontrado' : 'Esta pasta está vazia'}</p>{!searchQuery && <button onClick={() => { setCreateType('file'); setShowCreateDialog(true); }} className="text-xs text-blue-400 hover:text-blue-300 mt-2">Criar um arquivo</button>}</div>
            )}
          </div>
        </ScrollArea>

        {/* Drop zone */}
        <div
          className={cn(
            'hidden md:block p-3 border-t border-zinc-800/60 text-center transition-colors',
            isDragOver ? 'bg-blue-500/10 border-blue-500/40' : ''
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={cn(
            'border border-dashed rounded-lg p-3 transition-colors',
            isDragOver ? 'border-blue-500/50 text-blue-400' : 'border-zinc-800 text-zinc-600'
          )}>
            <Upload className="h-4 w-4 mx-auto mb-1" />
            <p className="text-xs">Solte arquivos ou .zip aqui</p>
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="relative z-10 hidden w-[3px] shrink-0 cursor-col-resize items-center justify-center md:flex"
        onMouseDown={fileTreeResize}
        onDoubleClick={fileTreeReset}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
        <div className="h-8 w-[3px] rounded-full bg-zinc-700 group-hover:bg-blue-500 group-active:bg-blue-400 transition-colors" />
      </div>

      {/* Content viewer */}
      <div className={cn('flex-1 flex-col min-w-0', selectedFile ? 'flex' : 'hidden md:flex')}>
        {selectedFile ? (
          <>
            <div className="flex min-w-0 items-center gap-2 border-b border-zinc-800/70 bg-zinc-900/55 px-3 py-2.5 sm:px-4">
              <Button variant="ghost" size="icon" onClick={() => { setSelectedFile(null); setFileContent(''); }} className="md:hidden h-9 w-9 shrink-0" aria-label="Voltar para arquivos"><ArrowLeft className="h-4 w-4" /></Button>
              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs font-medium text-zinc-300">{selectedFile.split('/').pop()}</span>
                <span className="block truncate font-mono text-[10px] text-zinc-600">{selectedFile}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {viewMode === 'view' ? (
                  selectedEditable ? <Button variant="outline" size="icon" onClick={() => setViewMode('edit')} className="h-8 w-8 text-zinc-300" title="Editar arquivo" aria-label="Editar arquivo">
                    <FileEdit className="h-3.5 w-3.5" />
                  </Button> : null
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={handleSave} disabled={pendingAction === 'save' || !isDirty} className="h-8 w-8 text-emerald-400 hover:text-emerald-300" title="Salvar alterações" aria-label="Salvar alterações">
                      {pendingAction === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setViewMode('view'); setEditContent(fileContent); }} className="h-8 w-8 text-zinc-500 hover:text-zinc-200" title="Cancelar edição" aria-label="Cancelar edição">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="icon" onClick={() => handleDownload(selectedFile)} className="h-8 w-8 text-zinc-400 hover:text-zinc-200" title="Baixar arquivo" aria-label="Baixar arquivo">
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              {fileLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Abrindo arquivo...</div>
              ) : viewMode === 'view' ? (
                <pre className="p-4 sm:p-6 text-[13px] font-mono text-zinc-300 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {fileContent}
                </pre>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full bg-zinc-950/50 p-4 sm:p-6 text-[13px] font-mono text-zinc-200 resize-none focus:outline-none min-h-[400px] leading-relaxed"
                  spellCheck={false}
                />
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/15 bg-blue-500/[0.06] text-blue-400/70 shadow-lg shadow-blue-950/10"><Sparkles className="h-5 w-5" /></span>
              <p className="text-sm font-medium text-zinc-300">Seu espaço de trabalho</p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">Selecione um arquivo para visualizar ou editar. Você também pode arrastar arquivos para qualquer área desta tela.</p>
              <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-500">
                <FolderOpen className="h-3 w-3" /> Duplo clique abre uma pasta
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={showCreateDialog} onOpenChange={open => { setShowCreateDialog(open); if (!open) setCreateName(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo {createType === 'file' ? 'arquivo' : 'pasta'}</DialogTitle>
            <DialogDescription>Informe um nome para {createType === 'file' ? 'o novo arquivo' : 'a nova pasta'}</DialogDescription>
          </DialogHeader>
          <Input
            placeholder={createType === 'file' ? 'filename.ts' : 'folder-name'}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={pendingAction === 'create'}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={pendingAction === 'create' || !createName.trim()}>{pendingAction === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {deleteType === 'directory' ? 'pasta' : 'arquivo'}</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <span className="font-mono text-zinc-300">{deletePath}</span>?
              {deleteType === 'directory' && ' Todo o conteúdo interno também será excluído.'}
              {' '}Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={pendingAction === 'delete'}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={pendingAction === 'delete'}>{pendingAction === 'delete' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear</DialogTitle>
            <DialogDescription>Informe um novo nome para <span className="font-mono text-zinc-300">{renameOldPath}</span></DialogDescription>
          </DialogHeader>
          <Input
            value={renameNewName}
            onChange={e => setRenameNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowRenameDialog(false)} disabled={pendingAction === 'rename'}>Cancelar</Button>
            <Button onClick={handleRename} disabled={pendingAction === 'rename' || !renameNewName.trim()}>{pendingAction === 'rename' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Renomear</Button>
          </div>
        </DialogContent>
      </Dialog>

      <PublishProjectDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        tree={tree}
        rootPath={currentPath}
      />
    </div>
  );
}

function joinPath(parent: string, child: string): string {
  const cleanChild = child.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleanChild) return parent;
  return parent === '.' ? cleanChild : `${parent.replace(/\/+$/, '')}/${cleanChild}`;
}

function relativeToRoot(path: string, root: string): string {
  if (path === root) return '';
  const prefix = root === '.' ? '' : `${root.replace(/\/+$/, '')}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'A operação não pôde ser concluída.';
}

function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  return entries.flatMap(entry => {
    const children = entry.children ? filterTree(entry.children, query) : undefined;
    if (entry.name.toLowerCase().includes(query) || children?.length) {
      return [{ ...entry, children }];
    }
    return [];
  });
}

function countTree(entries: FileEntry[]): number {
  return entries.reduce((total, entry) => total + 1 + (entry.children ? countTree(entry.children) : 0), 0);
}

function formatFileSize(size?: number): string {
  if (size == null) return 'Arquivo';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
