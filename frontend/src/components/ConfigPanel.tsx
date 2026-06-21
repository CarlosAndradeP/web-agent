import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { AppConfig, ApprovalMode, ModelInfo } from '../types';

const ALL_TOOLS = [
  'writeFile', 'readFile', 'listFiles', 'deleteFile',
  'runCommand', 'executeCode', 'searchFiles', 'webFetch', 'installPackage',
];

export default function ConfigPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.config.get().then(setConfig);
    api.models.list().then(data => setModels(data.models));
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.config.update(config);
      setConfig(updated);
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (tool: string) => {
    if (!config) return;
    const tools = config.approvalTools.includes(tool)
      ? config.approvalTools.filter(t => t !== tool)
      : [...config.approvalTools, tool];
    setConfig({ ...config, approvalTools: tools });
  };

  if (!config) return <div className="p-4 text-gray-400">Loading config...</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6 overflow-y-auto h-full">
      <h2 className="text-lg font-semibold">Configuration</h2>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Default Model</label>
        <select
          value={config.defaultModel}
          onChange={e => setConfig({ ...config, defaultModel: e.target.value })}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        >
          {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Max Steps</label>
        <input
          type="number"
          value={config.maxSteps}
          onChange={e => setConfig({ ...config, maxSteps: parseInt(e.target.value) || 100 })}
          min={1}
          max={500}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-2">Approval Mode</label>
        <div className="space-y-1">
          {(['none', 'all', 'custom'] as ApprovalMode[]).map(mode => (
            <label key={mode} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="approvalMode"
                value={mode}
                checked={config.approvalMode === mode}
                onChange={() => setConfig({ ...config, approvalMode: mode })}
              />
              <span className="capitalize">{mode}</span>
            </label>
          ))}
        </div>
      </div>

      {config.approvalMode === 'custom' && (
        <div>
          <label className="block text-sm text-gray-400 mb-2">Tools Requiring Approval</label>
          <div className="grid grid-cols-2 gap-1">
            {ALL_TOOLS.map(tool => (
              <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.approvalTools.includes(tool)}
                  onChange={() => toggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm text-gray-400 mb-1">API Base URL</label>
        <input
          type="text"
          value={config.apiBaseUrl}
          onChange={e => setConfig({ ...config, apiBaseUrl: e.target.value })}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">API Key</label>
        <input
          type="password"
          value={config.apiKey}
          onChange={e => setConfig({ ...config, apiKey: e.target.value })}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-4 py-2 text-sm font-medium"
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  );
}
