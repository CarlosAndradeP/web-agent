import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import TaskManager from './TaskManager';
import FileManager from './FileManager';
import ConfigPanel from './ConfigPanel';

type Tab = 'chat' | 'tasks' | 'files' | 'config';

export default function Layout() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [sessionId, setSessionId] = useState('default');

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <ChatPanel sessionId={sessionId} />}
        {activeTab === 'tasks' && <TaskManager />}
        {activeTab === 'files' && <FileManager />}
        {activeTab === 'config' && <ConfigPanel />}
      </main>
    </div>
  );
}
