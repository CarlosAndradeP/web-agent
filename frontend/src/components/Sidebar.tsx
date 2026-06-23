import { ListTodo, FolderOpen, Settings, Plus, Trash2, Shield, LogOut, Globe, Folder, ExternalLink, User, Play, Square } from 'lucide-react';
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
  isRunning: boolean;
}

export default function Sidebar({ activeTab, onTabChange, projects, activeProjectId, onProjectSelect, onProjectCreate, onProjectDelete, onProjectStart, onProjectStop, isRunning }: Props) {
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
    static: { label: 'S', color: 'bg-green-900 text-green-300' },
    php: { label: 'P', color: 'bg-purple-900 text-purple-300' },
    node: { label: 'N', color: 'bg-blue-900 text-blue-300' },
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800 w-56">
      <div className="p-3">
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
          )}
          <h1 className="text-sm font-bold text-zinc-100 tracking-tight">Web Agent</h1>
        </div>
      </div>

      <nav className="p-2 space-y-0.5">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all duration-150',
                activeTab === tab.id
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
              {tab.id === 'chat' && isRunning && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      <Separator className="my-2" />

      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Projects</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onProjectCreate}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 space-y-0.5">
          {projects.map(project => {
            const badge = typeBadge[project.type] || typeBadge.static;
            return (
              <div
                key={project.id}
                onClick={() => onProjectSelect(project.id, project.sessionId)}
                className={cn(
                  'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-150',
                  project.id === activeProjectId
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                )}
              >
                <span className={cn('h-4 w-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0', badge.color)}>
                  {badge.label}
                </span>
                {project.type === 'node' && (
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    project.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                  )} />
                )}
                <span className="text-xs truncate flex-1">{project.name}</span>
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  {project.type === 'node' && project.status === 'active' && (
                    <button
                      onClick={e => { e.stopPropagation(); onProjectStop(project.id); }}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                      title="Stop project"
                    >
                      <Square className="h-3 w-3 text-red-400 hover:text-red-300" />
                    </button>
                  )}
                  {project.type === 'node' && project.status !== 'active' && (
                    <button
                      onClick={e => { e.stopPropagation(); onProjectStart(project.id); }}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                      title="Start project"
                    >
                      <Play className="h-3 w-3 text-emerald-400 hover:text-emerald-300" />
                    </button>
                  )}
                  <a
                    href={`/p/${project.uuid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                    title="Open project URL"
                  >
                    <ExternalLink className="h-3 w-3 text-zinc-400" />
                  </a>
                  <button
                    onClick={e => { e.stopPropagation(); onProjectDelete(project.id); }}
                    className="h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                    title="Delete project"
                  >
                    <Trash2 className="h-3 w-3 text-zinc-400 hover:text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="px-2 py-4 text-center">
              <Folder className="h-6 w-6 mx-auto mb-1 text-zinc-700" />
              <p className="text-[11px] text-zinc-600">No projects yet</p>
              <p className="text-[10px] text-zinc-700">Click + to create one</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-zinc-800 space-y-2">
        {user && (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300">
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-zinc-300 truncate">{user.username}</div>
              <div className="text-[10px] text-zinc-600">{user.credits} credits</div>
            </div>
            <button
              onClick={logout}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
              title="Logout"
            >
              <LogOut className="h-3 w-3 text-zinc-500 hover:text-red-400" />
            </button>
          </div>
        )}
        <div className="text-[10px] text-zinc-600">v1.0.0</div>
      </div>
    </div>
  );
}
