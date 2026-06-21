type Tab = 'chat' | 'tasks' | 'files' | 'config';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'config', label: 'Config', icon: '⚙️' },
];

export default function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <aside className="w-16 md:w-48 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-3 border-b border-gray-700">
        <h1 className="text-sm md:text-lg font-bold text-blue-400">Web Agent</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
