import { MessageSquare, ListTodo, FolderOpen, Settings, Plus, Trash2, Shield, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { useAuth } from '../contexts/AuthContext';
import type { Session } from '../types';

type Tab = 'chat' | 'tasks' | 'files' | 'config' | 'admin';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  sessions: Session[];
  activeSessionId: string;
  onSessionSelect: (id: string) => void;
  onSessionCreate: () => void;
  onSessionDelete: (id: string) => void;
  isRunning: boolean;
}

export default function Sidebar({ activeTab, onTabChange, sessions, activeSessionId, onSessionSelect, onSessionCreate, onSessionDelete, isRunning }: Props) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'tasks', label: 'Tasks', icon: ListTodo },
    { id: 'files', label: 'Files', icon: FolderOpen },
    { id: 'config', label: 'Config', icon: Settings },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Admin', icon: Shield }] : []),
  ];

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
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Sessions</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onSessionCreate}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 space-y-0.5">
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => onSessionSelect(session.id)}
              className={cn(
                'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-150',
                session.id === activeSessionId
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              )}
            >
              <MessageSquare className="h-3 w-3 shrink-0" />
              <span className="text-xs truncate flex-1">{session.name}</span>
              <button
                onClick={e => { e.stopPropagation(); onSessionDelete(session.id); }}
                className="opacity-0 group-hover:opacity-100 h-4 w-4 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
              >
                <Trash2 className="h-3 w-3 text-zinc-500 hover:text-red-400" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-[11px] text-zinc-600 px-2 py-1">No sessions yet</p>
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
