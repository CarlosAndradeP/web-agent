import { ListTodo, FolderOpen, Settings, Plus, Trash2, Shield, LogOut, Globe, ExternalLink, User, Play, Square, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { useAuth } from '../contexts/AuthContext';
import type { Project } from '../types';

type Tab = 'chat' | 'tasks' | 'files' | 'config' | 'admin' | 'account';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  projects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string, sessionId: string | null) => void;
  onProjectCreate: () => void;
  onProjectDelete: (id: string) => void;
  onProjectStart: (id: string) => void;
  onProjectStop: (id: string) => void;
  onPromoteNode: (id: string) => void;
  isRunning: boolean;
}

export default function Sidebar({ activeTab, onTabChange, projects, activeProjectId, onProjectSelect, onProjectCreate, onProjectDelete, onProjectStart, onProjectStop, onPromoteNode, isRunning }: Props) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'chat', label: 'Chat', icon: ListTodo },
    { id: 'files', label: 'Files', icon: FolderOpen },
    { id: 'config', label: 'Config', icon: Settings },
    ...(isAdmin
      ? [{ id: 'admin' as Tab, label: 'Admin', icon: Shield }]
      : [{ id: 'account' as Tab, label: 'Account', icon: User }]
    ),
  ];

  const typeBadge: Record<string, { label: string; color: string }> = {
    static: { label: '', color: 'bg-zinc-800 text-zinc-400' },
    php: { label: 'P', color: 'bg-purple-900/60 text-purple-300 border border-purple-700/30' },
    node: { label: 'N', color: 'bg-blue-900/60 text-blue-300 border border-blue-700/30' },
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Logo */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0">
            <Globe className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold text-zinc-100 tracking-tight">Web Agent</h1>
            {isRunning && (
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 space-y-0.5">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                isActive
                  ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-blue-400' : '')} />
              <span>{tab.label}</span>
              {tab.id === 'chat' && isRunning && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="mx-4 my-3 h-px bg-zinc-800" />

      {/* Projects header */}
      <div className="px-4 py-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">Projects</span>
        <Button variant="ghost" size="icon" className="h-5 w-5 text-zinc-500 hover:text-zinc-200" onClick={onProjectCreate}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Project list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 space-y-0.5 pb-2">
          {projects.map(project => {
            const badge = typeBadge[project.type] || typeBadge.static;
            const isNode = project.type === 'node';
            const showNodeReady = project.type === 'static' && project.nodeReady;
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                onClick={() => onProjectSelect(project.id, project.sessionId)}
                className={cn(
                  'group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150',
                  isActive
                    ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
                )}
              >
                <span className={cn('h-5 w-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0', badge.color)}>
                  {badge.label ? badge.label : <Globe className="h-2.5 w-2.5" />}
                </span>
                {isNode && (
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    project.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                  )} />
                )}
                <span className="text-xs truncate flex-1 min-w-0">{project.name}</span>
                <div className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {isNode && project.status === 'active' && (
                    <button
                      onClick={e => { e.stopPropagation(); onProjectStop(project.id); }}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
                      title="Stop project"
                    >
                      <Square className="h-3 w-3 text-red-400" />
                    </button>
                  )}
                  {isNode && project.status !== 'active' && (
                    <button
                      onClick={e => { e.stopPropagation(); onProjectStart(project.id); }}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
                      title="Start project"
                    >
                      <Play className="h-3 w-3 text-emerald-400" />
                    </button>
                  )}
                  {showNodeReady && (
                    <button
                      onClick={e => { e.stopPropagation(); onPromoteNode(project.id); }}
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
                      title="Iniciar Node.js"
                    >
                      <Zap className="h-3 w-3 text-amber-400" />
                    </button>
                  )}
                  <a
                    href={`/p/${project.uuid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
                    title="Open project URL"
                  >
                    <ExternalLink className="h-3 w-3 text-zinc-500" />
                  </a>
                  <button
                    onClick={e => { e.stopPropagation(); onProjectDelete(project.id); }}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700/80 transition-colors"
                    title="Delete project"
                  >
                    <Trash2 className="h-3 w-3 text-zinc-500 hover:text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="px-2 py-6 text-center">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-zinc-800" />
              <p className="text-[11px] text-zinc-600 font-medium">No projects yet</p>
              <p className="text-[10px] text-zinc-700 mt-0.5">Click + to create one</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800/60">
        {user && (
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-zinc-300 truncate">{user.username}</div>
              <div className="text-[10px] text-zinc-600">{user.credits} credits</div>
            </div>
            <button
              onClick={logout}
              className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors"
              title="Logout"
            >
              <LogOut className="h-3 w-3 text-zinc-600 hover:text-red-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
