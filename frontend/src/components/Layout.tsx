import { useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import TaskManager from './TaskManager';
import FileManager from './FileManager';
import ConfigPanel from './ConfigPanel';
import Header from './Header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useSessions } from '../hooks/useSessions';
import { useSocket } from '../hooks/useSocket';

type Tab = 'chat' | 'tasks' | 'files' | 'config';

export default function Layout() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [sessionId, setSessionId] = useState('default');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const { sessions, createSession, deleteSession } = useSessions();
  const { connected } = useSocket();

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }, []);

  const handleSessionCreate = useCallback(async () => {
    const name = newSessionName.trim() || `Session ${sessions.length + 1}`;
    const session = await createSession(name);
    setSessionId(session.id);
    setNewSessionName('');
    setShowCreateDialog(false);
  }, [newSessionName, sessions.length, createSession]);

  const handleSessionDelete = useCallback(async (id: string) => {
    await deleteSession(id);
    if (id === sessionId) {
      setSessionId(sessions.length > 1 ? sessions.find(s => s.id !== id)?.id || 'default' : 'default');
    }
  }, [deleteSession, sessionId, sessions]);

  const handleSessionSelect = useCallback((id: string) => {
    setSessionId(id);
    setMobileMenuOpen(false);
  }, []);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-zinc-950 text-zinc-100">
      <div className="hidden md:block">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          sessions={sessions}
          activeSessionId={sessionId}
          onSessionSelect={handleSessionSelect}
          onSessionCreate={() => setShowCreateDialog(true)}
          onSessionDelete={handleSessionDelete}
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
              sessions={sessions}
              activeSessionId={sessionId}
              onSessionSelect={handleSessionSelect}
              onSessionCreate={() => setShowCreateDialog(true)}
              onSessionDelete={handleSessionDelete}
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
          sessionName={sessions.find(s => s.id === sessionId)?.name}
        />

        <main className="flex-1 overflow-hidden relative">
          <div className={activeTab === 'chat' ? 'h-full' : 'h-full hidden'}>
            <ChatPanel sessionId={sessionId} />
          </div>
          <div className={activeTab === 'tasks' ? 'h-full' : 'h-full hidden'}>
            <TaskManager />
          </div>
          <div className={activeTab === 'files' ? 'h-full' : 'h-full hidden'}>
            <FileManager />
          </div>
          <div className={activeTab === 'config' ? 'h-full' : 'h-full hidden'}>
            <ConfigPanel />
          </div>
        </main>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
            <DialogDescription>Create a new conversation session</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Session name..."
              value={newSessionName}
              onChange={e => setNewSessionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSessionCreate()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button onClick={handleSessionCreate}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
