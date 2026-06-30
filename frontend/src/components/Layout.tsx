import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import FileManager from './FileManager';
import ConfigPanel from './ConfigPanel';
import AdminPanel from './AdminPanel';
import UserPanel from './UserPanel';
import Header from './Header';
import AutonomousPanel from './AutonomousPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useProjects } from '../hooks/useProjects';
import { useSessions } from '../hooks/useSessions';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { useResizable } from '../hooks/useResizable';
import { api } from '../lib/api';
import type { Project } from '../types';

type Tab = 'chat' | 'autonomous' | 'tasks' | 'files' | 'config' | 'admin' | 'account';

export default function Layout() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectFolder, setNewProjectFolder] = useState('');
  const [existingFolders, setExistingFolders] = useState<{ name: string; path: string }[]>([]);
  const [useExistingFolder, setUseExistingFolder] = useState(false);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const { projects, createProject, deleteProject, startProject, stopProject, promoteNode, refresh: refreshProjects } = useProjects();
  const { sessions, createSession } = useSessions();
  const { connected } = useSocket();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

  const { width: sidebarWidth, handleMouseDown: sidebarResize, handleDoubleClick: sidebarReset } = useResizable({
    storageKey: 'webagent_sidebar_width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 400,
  });

  useEffect(() => {
    if (showCreateDialog) {
      api.files.listFolders('.').then(data => {
        setExistingFolders(data.folders);
      }).catch(() => {});
    }
  }, [showCreateDialog]);

  const handleTabChange = useCallback((tab: Tab) => {
    if (tab === 'admin' && !isAdmin) return;
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }, [isAdmin]);

  const handleProjectCreate = useCallback(async () => {
    const name = newProjectName.trim() || `Project ${projects.length + 1}`;
    let folderPath: string;
    if (useExistingFolder && newProjectFolder) {
      folderPath = newProjectFolder;
    } else {
      folderPath = newProjectFolder.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    try {
      const project = await createProject(name, folderPath);
      setActiveProjectId(project.id);
      if (project.sessionId) {
        setSessionId(project.sessionId);
      }
      setNewProjectName('');
      setNewProjectFolder('');
      setUseExistingFolder(false);
      setShowCreateDialog(false);
      setActiveTab('chat');
    } catch (err: any) {
      alert(`Failed to create project: ${err.message}`);
    }
  }, [newProjectName, newProjectFolder, useExistingFolder, projects.length, createProject]);

  const handleProjectDelete = useCallback(async (id: string) => {
    const project = projects.find(p => p.id === id);
    await deleteProject(id);
    if (id === activeProjectId) {
      const remaining = projects.filter(p => p.id !== id);
      if (remaining.length > 0) {
        setActiveProjectId(remaining[0].id);
        setSessionId(remaining[0].sessionId);
      } else {
        setActiveProjectId(null);
        setSessionId(null);
      }
    }
  }, [deleteProject, activeProjectId, projects]);

  const handleProjectSelect = useCallback((projectId: string, projSessionId: string | null) => {
    setActiveProjectId(projectId);
    if (projSessionId) {
      setSessionId(projSessionId);
    }
    setActiveTab('chat');
    setMobileMenuOpen(false);
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession('New Session');
      setSessionId(session.id);
    } catch (err: any) {
      console.error('Failed to create new session:', err);
    }
  }, [createSession]);

  const effectiveSessionId = sessionId || 'default';
  const activeProject = projects.find(p => p.id === activeProjectId);

  const sidebarProps = {
    activeTab,
    onTabChange: handleTabChange,
    projects,
    activeProjectId,
    onProjectSelect: handleProjectSelect,
    onProjectCreate: () => setShowCreateDialog(true),
    onProjectDelete: handleProjectDelete,
    onProjectStart: startProject,
    onProjectStop: stopProject,
    onPromoteNode: promoteNode,
    isRunning: isChatStreaming,
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Desktop sidebar + resize handle */}
      <div className="hidden md:flex shrink-0 border-r border-zinc-800/60" style={{ width: sidebarWidth }}>
        <Sidebar {...sidebarProps} />
      </div>
      <div
        className="hidden md:flex w-[3px] shrink-0 cursor-col-resize items-center justify-center group relative"
        onMouseDown={sidebarResize}
        onDoubleClick={sidebarReset}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
        <div className="h-8 w-[3px] rounded-full bg-zinc-700 group-hover:bg-blue-500 group-active:bg-blue-400 transition-colors" />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden animate-in" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden w-72 animate-in shadow-2xl">
            <Sidebar {...sidebarProps} />
          </div>
        </>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
          menuOpen={mobileMenuOpen}
          isRunning={isChatStreaming}
          sessionName={activeProject?.name}
        />

        <main className="flex-1 overflow-hidden">
          <div className={activeTab === 'chat' ? 'h-full' : 'h-full hidden'}>
            {effectiveSessionId ? (
              <ChatPanel key={effectiveSessionId} sessionId={effectiveSessionId} onStreamingChange={setIsChatStreaming} onNewSession={handleNewSession} basePath={activeProject?.folderPath} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                  <div className="h-12 w-12 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mx-auto">
                    <span className="text-lg">+</span>
                  </div>
                  <p className="text-sm text-zinc-500">Select or create a project to start</p>
                </div>
              </div>
            )}
          </div>
          <div className={activeTab === 'autonomous' ? 'h-full' : 'h-full hidden'}>
            <AutonomousPanel />
          </div>
          <div className={activeTab === 'tasks' ? 'h-full' : 'h-full hidden'}>
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-zinc-500">Tasks are tracked per-project in the chat</p>
            </div>
          </div>
          <div className={activeTab === 'files' ? 'h-full' : 'h-full hidden'}>
            <FileManager basePath={activeProject?.folderPath || '.'} />
          </div>
          <div className={activeTab === 'config' ? 'h-full' : 'h-full hidden'}>
            <ConfigPanel />
          </div>
          {isAdmin && (
            <div className={activeTab === 'admin' ? 'h-full' : 'h-full hidden'}>
              <AdminPanel />
            </div>
          )}
          {!isAdmin && (
            <div className={activeTab === 'account' ? 'h-full' : 'h-full hidden'}>
              <UserPanel />
            </div>
          )}
        </main>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a new project with a linked chat session</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Project name..."
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleProjectCreate()}
              autoFocus
            />
            <div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="use-existing"
                  checked={useExistingFolder}
                  onChange={e => setUseExistingFolder(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                <label htmlFor="use-existing" className="text-xs text-zinc-400 cursor-pointer">Use existing folder in workspace</label>
              </div>
              {useExistingFolder ? (
                <select
                  value={newProjectFolder}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewProjectFolder(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs text-zinc-200"
                >
                  <option value="">Select a folder...</option>
                  {existingFolders.map(f => (
                    <option key={f.path} value={f.path}>{f.name}</option>
                  ))}
                </select>
              ) : (
                <Input
                  placeholder="Folder name (auto-generated from project name)"
                  value={newProjectFolder}
                  onChange={e => setNewProjectFolder(e.target.value)}
                  className="text-xs"
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setShowCreateDialog(false);
                setNewProjectName('');
                setNewProjectFolder('');
                setUseExistingFolder(false);
              }}>Cancel</Button>
              <Button onClick={handleProjectCreate}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
