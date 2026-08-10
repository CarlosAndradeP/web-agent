import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { AppConfig, ApprovalMode, ModelInfo } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Save } from 'lucide-react';

const ALL_TOOLS = [
  'writeFile', 'readFile', 'listFiles', 'deleteFile',
  'runCommand', 'executeCode', 'searchFiles', 'webFetch', 'installPackage',
];

const approvalModeLabels: Record<ApprovalMode, string> = {
  none: 'Nenhuma',
  all: 'Todas',
  custom: 'Personalizada',
};

export default function ConfigPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  if (!config) return <div className="p-4 text-zinc-500">Carregando configuração...</div>;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Configuração</h2>
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Modelo padrão</label>
            <select
              value={config.defaultModel}
              onChange={e => setConfig({ ...config, defaultModel: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Máximo de etapas</label>
            <Input
              type="number"
              value={config.maxSteps}
              onChange={e => setConfig({ ...config, maxSteps: parseInt(e.target.value) || 100 })}
              min={1}
              max={500}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-2 font-medium">Modo de aprovação</label>
            <div className="flex gap-2">
              {(['none', 'all', 'custom'] as ApprovalMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setConfig({ ...config, approvalMode: mode })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    config.approvalMode === mode
                      ? 'bg-zinc-100 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {approvalModeLabels[mode]}
                </button>
              ))}
            </div>
          </div>

          {config.approvalMode === 'custom' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-2 font-medium">Ferramentas que exigem aprovação</label>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_TOOLS.map(tool => (
                  <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer text-zinc-300">
                    <input
                      type="checkbox"
                      checked={config.approvalTools.includes(tool)}
                      onChange={() => toggleTool(tool)}
                      className="rounded border-zinc-600 bg-zinc-800"
                    />
                    <span className="font-mono">{tool}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">URL base da API</label>
            <Input
              type="text"
              value={config.apiBaseUrl}
              onChange={e => setConfig({ ...config, apiBaseUrl: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Chave da API</label>
            <Input
              type="password"
              value={config.apiKey ?? ''}
              placeholder={config.apiKeyConfigured ? '•••••••• (configurada)' : 'Não configurada'}
              onChange={e => setConfig({ ...config, apiKey: e.target.value })}
            />
            {config.apiKeyConfigured && !config.apiKey && (
              <p className="text-[10px] text-zinc-600 mt-1">A chave já está configurada. Deixe em branco para manter o valor atual.</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Tipo de agente</label>
            <select
              value={config.agentType || 'none'}
              onChange={e => setConfig({ ...config, agentType: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value="none">Nenhum (round-robin em todas as chaves)</option>
              <option value="main">Principal (chaves primárias primeiro)</option>
              <option value="sub">Subagente (round-robin nas chaves de subagente)</option>
            </select>
            <p className="text-[10px] text-zinc-600 mt-1">Estratégia de roteamento de chaves para o proxy NIM</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
