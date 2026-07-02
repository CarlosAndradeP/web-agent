import { useState, useCallback, useEffect, useRef } from 'react';
import { useFiles } from '../hooks/useFiles';
import { useResizable } from '../hooks/useResizable';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { FileEntry, Project } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
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
  ChevronUp,
  Archive,
  PackageOpen,
} from 'lucide-react';
import { cn } from '../lib/utils';

type ViewMode = 'view' | 'edit';

interface FileNodeProps {
  entry: FileEntry;
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, type: string) => void;
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
          'group flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-lg text-sm transition-colors',
          isSelected ? 'bg-zinc-800/80 text-zinc-100' : 'hover:bg-zinc-800/40 text-zinc-400 hover:text-zinc-200'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          onSelect(path, entry.type);
        }}
        onDoubleClick={() => {
          if (isDir) onNavigateInto(path);
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
        <span className="truncate text-xs flex-1 min-w-0">{entry.name}</span>
        {entry.size != null && (
          <span className="text-[10px] text-zinc-600 shrink-0 ml-1 tabular-nums">{(entry.size / 1024).toFixed(1)}K</span>
        )}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            onClick={e => { e.stopPropagation(); onRename(path, entry.type); }}
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
            title="Rename"
          >
            <Pencil className="h-3 w-3 text-zinc-500" />
          </button>
          {!isDir && (
            <button
              onClick={e => { e.stopPropagation(); onDownload(path); }}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
              title="Download"
            >
              <Download className="h-3 w-3 text-zinc-500" />
            </button>
          )}
          {isDir && (
            <button
              onClick={e => { e.stopPropagation(); onDownloadZip(path); }}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
              title="Download as ZIP"
            >
              <Archive className="h-3 w-3 text-zinc-500" />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDelete(path, entry.type); }}
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3 w-3 text-zinc-500 hover:text-red-400" />
          </button>
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
  const { tree, loading, refresh } = useFiles(currentPath);
  const { authFetch } = useAuth();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
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
  const [pathHistory, setPathHistory] = useState<string[]>([basePath]);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const { width: fileTreeWidth, handleMouseDown: fileTreeResize, handleDoubleClick: fileTreeReset } = useResizable({
    storageKey: 'webagent_filetree_width',
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 480,
  });

  useEffect(() => {
    setCurrentPath(basePath);
    setPathHistory([basePath]);
  }, [basePath]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFile(null);
    setFileContent('');
    setPathHistory(prev => [...prev, path]);
  }, []);

  const navigateUp = useCallback(() => {
    const parent = currentPath.includes('/') ? currentPath.split('/').slice(0, -1).join('/') : '.';
    setCurrentPath(parent);
    setSelectedFile(null);
    setFileContent('');
  }, [currentPath]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    const segments = currentPath === '.' ? [] : currentPath.split('/');
    if (index === -1) {
      navigateTo('.');
    } else {
      const newPath = segments.slice(0, index + 1).join('/');
      navigateTo(newPath);
    }
  }, [currentPath, navigateTo]);

  const pathSegments = currentPath === '.' ? [] : currentPath.split('/');

  const handleSelect = useCallback(async (path: string, type: string) => {
    if (type === 'file') {
      const data = await api.files.content(path);
      setSelectedFile(data.path);
      setFileContent(data.content);
      setEditContent(data.content);
      setViewMode('view');
    }
  }, []);

  const handleDownload = useCallback(async (path: string) => {
    try {
      const url = api.files.downloadUrl(path);
      const blob = await api.files.downloadBlob(url);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = path.split('/').pop() || 'file';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, []);

  const handleDownloadZip = useCallback(async (path: string) => {
    try {
      const url = api.files.downloadZipUrl(path);
      const blob = await api.files.downloadBlob(url);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${path.split('/').pop() || 'folder'}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    await api.files.delete(deletePath);
    setShowDeleteDialog(false);
    if (selectedFile === deletePath || selectedFile?.startsWith(deletePath + '/')) {
      setSelectedFile(null);
      setFileContent('');
    }
    refresh();
  }, [deletePath, selectedFile, refresh]);

  const handleRename = useCallback(async () => {
    const newName = renameNewName.trim();
    if (!newName) return;
    const parts = renameOldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    await api.files.rename(renameOldPath, newPath);
    setShowRenameDialog(false);
    if (selectedFile === renameOldPath) {
      setSelectedFile(newPath);
    }
    setRenameNewName('');
    refresh();
  }, [renameNewName, renameOldPath, selectedFile, refresh]);

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return;
    if (createType === 'file') {
      await api.files.createFile(name);
    } else {
      await api.files.mkdir(name);
    }
    setShowCreateDialog(false);
    setCreateName('');
    refresh();
  }, [createName, createType, refresh]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    await api.files.write(selectedFile, editContent);
    setFileContent(editContent);
    setViewMode('view');
  }, [selectedFile, editContent]);

  const handleUpload = async (files: FileList) => {
    const fileArr = Array.from(files);
    const zipFiles = fileArr.filter(f => f.name.endsWith('.zip'));
    const otherFiles = fileArr.filter(f => !f.name.endsWith('.zip'));

    for (const file of otherFiles) {
      const formData = new FormData();
      formData.append('files', file);
      if (currentPath !== '.') {
        formData.append('destination', currentPath);
      }
      try {
        await authFetch('/api/files/upload', {
          method: 'POST',
          body: formData,
        });
      } catch {}
    }

    for (const file of zipFiles) {
      try {
        await api.files.extractZip(file, currentPath === '.' ? undefined : currentPath);
      } catch {}
    }

    refresh();
  };

  const handleExtractZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.files.extractZip(file, currentPath === '.' ? undefined : currentPath);
      refresh();
    } catch (err: any) {
      alert(`Failed to extract zip: ${err.message}`);
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

  if (loading) return <div className="p-4 text-zinc-500">Loading files...</div>;

  return (
    <div className="flex h-full">
      {/* File tree panel */}
      <div className="w-full md:shrink-0 flex flex-col bg-zinc-900/30" style={{ width: fileTreeWidth }}>
        {/* Toolbar */}
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-zinc-200">Files</h2>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={() => { setCreateType('file'); setShowCreateDialog(true); }} title="New File">
                <FilePlus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={() => { setCreateType('folder'); setShowCreateDialog(true); }} title="New Folder">
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={() => { document.getElementById('file-upload')?.click(); }} title="Upload">
                <Upload className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={() => { zipInputRef.current?.click(); }} title="Extract ZIP">
                <PackageOpen className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={refresh} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-200" onClick={() => setShowPublishDialog(true)} title="Publish Project">
                <Globe className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <input
            id="file-upload"
            type="file"
            multiple
            className="hidden"
            onChange={e => e.target.files && handleUpload(e.target.files)}
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleExtractZip}
          />

          {/* Breadcrumb */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-zinc-600 hover:text-zinc-300" onClick={navigateUp} title="Go up" disabled={currentPath === '.'}>
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <div className="flex items-center gap-0.5 overflow-x-auto text-[10px] min-w-0 scrollbar-none">
              <button
                onClick={() => navigateTo('.')}
                className={cn(
                  'shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-800/60 transition-colors',
                  pathSegments.length === 0 ? 'text-zinc-200 bg-zinc-800/60' : 'text-zinc-600 hover:text-zinc-300'
                )}
              >
                root
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

        {/* File tree */}
        <ScrollArea className="flex-1">
          <div className="p-1.5">
            {tree.map(entry => (
              <FileNode
                key={entry.name}
                entry={entry}
                path={entry.name}
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
            {tree.length === 0 && (
              <div className="p-6 text-center text-zinc-600 text-xs">Empty folder</div>
            )}
          </div>
        </ScrollArea>

        {/* Drop zone */}
        <div
          className={cn(
            'p-3 border-t border-zinc-800/60 text-center transition-colors',
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
            <p className="text-[10px]">Drop files or .zip here</p>
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="hidden md:flex w-[3px] shrink-0 cursor-col-resize items-center justify-center group relative"
        onMouseDown={fileTreeResize}
        onDoubleClick={fileTreeReset}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
        <div className="h-8 w-[3px] rounded-full bg-zinc-700 group-hover:bg-blue-500 group-active:bg-blue-400 transition-colors" />
      </div>

      {/* Content viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFile ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/60 bg-zinc-900/30">
              <span className="text-xs text-zinc-500 font-mono truncate flex-1">{selectedFile}</span>
              <div className="flex items-center gap-1 shrink-0">
                {viewMode === 'view' ? (
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('edit')} className="h-7 text-xs gap-1 text-zinc-500 hover:text-zinc-200">
                    <FileEdit className="h-3 w-3" /> Edit
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={handleSave} className="h-7 text-xs gap-1 text-emerald-400 hover:text-emerald-300">
                      <Save className="h-3 w-3" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setViewMode('view'); setEditContent(fileContent); }} className="h-7 text-xs gap-1 text-zinc-500 hover:text-zinc-200">
                      <X className="h-3 w-3" /> Cancel
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => handleDownload(selectedFile)} className="h-7 text-xs gap-1 text-zinc-500 hover:text-zinc-200">
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              {viewMode === 'view' ? (
                <pre className="p-4 text-xs font-mono text-zinc-300 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {fileContent}
                </pre>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full bg-transparent p-4 text-xs font-mono text-zinc-300 resize-none focus:outline-none min-h-[400px] leading-relaxed"
                  spellCheck={false}
                />
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <File className="h-10 w-10 mx-auto text-zinc-800" />
              <p className="text-sm text-zinc-600">Select a file to view</p>
              <p className="text-[11px] text-zinc-700">Double-click a folder to navigate into it</p>
              <p className="text-[11px] text-zinc-700">or drag & drop files / .zip to upload</p>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {createType === 'file' ? 'File' : 'Folder'}</DialogTitle>
            <DialogDescription>Enter a name for the new {createType}</DialogDescription>
          </DialogHeader>
          <Input
            placeholder={createType === 'file' ? 'filename.ts' : 'folder-name'}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteType === 'directory' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-mono text-zinc-300">{deletePath}</span>?
              {deleteType === 'directory' && ' This will delete all contents inside.'}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Enter a new name for <span className="font-mono text-zinc-300">{renameOldPath}</span></DialogDescription>
          </DialogHeader>
          <Input
            value={renameNewName}
            onChange={e => setRenameNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowRenameDialog(false)}>Cancel</Button>
            <Button onClick={handleRename}>Rename</Button>
          </div>
        </DialogContent>
      </Dialog>

      <PublishProjectDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        tree={tree}
      />
    </div>
  );
}
