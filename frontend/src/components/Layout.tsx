import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import FileManager from './FileManager';
import ConfigPanel from './ConfigPanel';
import AdminPanel from './AdminPanel';
import UserPanel from './UserPanel';
import Header from './Header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useProjects } from '../hooks/useProjects';
import { useSessions } from '../hooks/useSessions';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import type { Project } from '../types';

type Tab = 'chat' | 'tasks' | 'files' | 'config' | 'admin' | 'account';

export default function Layout() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectType, setNewProjectType] = useState<'static' | 'php' | 'node'>('static');
  const [newProjectFolder, setNewProjectFolder] = useState('');
  const [existingFolders, setExistingFolders] = useState<{ name: string; path: string }[]>([]);
  const [useExistingFolder, setUseExistingFolder] = useState(false);
  const { projects, createProject, deleteProject, startProject, stopProject, refresh: refreshProjects } = useProjects();
  const { sessions, createSession } = useSessions();
  const { connected } = useSocket();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

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
      const project = await createProject(name, folderPath, newProjectType);
      setActiveProjectId(project.id);
      if (project.sessionId) {
        setSessionId(project.sessionId);
      }
      setNewProjectName('');
      setNewProjectType('static');
      setNewProjectFolder('');
      setUseExistingFolder(false);
      setShowCreateDialog(false);
      setActiveTab('chat');
    } catch (err: any) {
      alert(`Failed to create project: ${err.message}`);
    }
  }, [newProjectName, newProjectType, newProjectFolder, useExistingFolder, projects.length, createProject]);

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

  const effectiveSessionId = sessionId || 'default';
  const activeProject = projects.find(p => p.id === activeProjectId);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-zinc-950 text-zinc-100">
      <div className="hidden md:block">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectSelect={handleProjectSelect}
          onProjectCreate={() => setShowCreateDialog(true)}
          onProjectDelete={handleProjectDelete}
          onProjectStart={startProject}
          onProjectStop={stopProject}
          isRunning={false}
        />
      </div>

      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <Sidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              projects={projects}
              activeProjectId={activeProjectId}
              onProjectSelect={handleProjectSelect}
              onProjectCreate={() => setShowCreateDialog(true)}
              onProjectDelete={handleProjectDelete}
              onProjectStart={startProject}
              onProjectStop={stopProject}
              isRunning={false}
            />
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
          menuOpen={mobileMenuOpen}
          isRunning={false}
          sessionName={activeProject?.name}
        />

        <main className="flex-1 overflow-hidden relative">
          <div className={activeTab === 'chat' ? 'h-full' : 'h-full hidden'}>
            {effectiveSessionId ? (
              <ChatPanel key={effectiveSessionId} sessionId={effectiveSessionId} />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-600">
                <div className="text-center">
                  <p className="text-sm">Select or create a project to start</p>
                </div>
              </div>
            )}
          </div>
          <div className={activeTab === 'tasks' ? 'h-full' : 'h-full hidden'}>
            <div className="flex items-center justify-center h-full text-zinc-600">
              <p className="text-sm">Tasks are tracked per-project in the chat</p>
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
              <label className="text-xs text-zinc-500 mb-1 block">Project Type</label>
              <select
                value={newProjectType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewProjectType(e.target.value as any)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs text-zinc-200"
              >
                <option value="static">Static (HTML/CSS/JS)</option>
                <option value="php">PHP (via Apache)</option>
                <option value="node">Node.js (Express, etc.)</option>
              </select>
            </div>
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
