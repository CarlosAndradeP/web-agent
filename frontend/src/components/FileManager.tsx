import { useState } from 'react';
import { useFiles } from '../hooks/useFiles';
import { api } from '../lib/api';
import type { FileEntry } from '../types';

export default function FileManager() {
  const { tree, loading, refresh } = useFiles();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [viewingFile, setViewingFile] = useState(false);

  const handleSelect = async (path: string, type: string) => {
    if (type === 'file') {
      const data = await api.files.content(path);
      setSelectedFile(data.path);
      setFileContent(data.content);
      setViewingFile(true);
    }
  };

  if (loading) return <div className="p-4 text-gray-400">Loading files...</div>;

  const renderTree = (entries: FileEntry[], prefix = '') => (
    <div className="ml-4">
      {entries.map(entry => (
        <div key={prefix + entry.name}>
          <div
            className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-700 rounded px-1"
            onClick={() => handleSelect(prefix + entry.name, entry.type)}
          >
            <span className="text-xs">{entry.type === 'directory' ? '📁' : '📄'}</span>
            <span className="text-sm">{entry.name}</span>
            {entry.size != null && (
              <span className="text-xs text-gray-500 ml-auto">{(entry.size / 1024).toFixed(1)}KB</span>
            )}
          </div>
          {entry.children && renderTree(entry.children, prefix + entry.name + '/')}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-full">
      <div className="w-1/2 border-r border-gray-700 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Workspace</h2>
          <button onClick={refresh} className="text-xs text-gray-400 hover:text-white">Refresh</button>
        </div>
        {renderTree(tree)}
      </div>
      <div className="w-1/2 overflow-y-auto p-3">
        {viewingFile ? (
          <div>
            <div className="text-sm text-gray-400 mb-2">{selectedFile}</div>
            <pre className="bg-gray-800 rounded p-3 text-sm overflow-x-auto whitespace-pre-wrap font-mono">
              {fileContent}
            </pre>
          </div>
        ) : (
          <div className="text-gray-500 text-sm">Select a file to view its contents</div>
        )}
      </div>
    </div>
  );
}
