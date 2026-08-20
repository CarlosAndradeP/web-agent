import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { UserPublic, CreditTransaction, AdminModelInfo, NodeProcessInfo, LlmRateLimitStatus } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Users, CreditCard, BarChart3, Cpu, ToggleLeft, ToggleRight, Server, Square, RotateCw, RefreshCw, CheckSquare, Square as SquareBox, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

type AdminTab = 'users' | 'models' | 'processes' | 'settings' | 'stats';

const userRoleLabels: Record<string, string> = {
  admin: 'admin',
  user: 'usuário',
};

const processStatusLabels: Record<string, string> = {
  running: 'rodando',
  stopped: 'parado',
  error: 'erro',
};

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [models, setModels] = useState<AdminModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserPublic | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditHistory, setCreditHistory] = useState<CreditTransaction[]>([]);
  const [historyBalance, setHistoryBalance] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editCost, setEditCost] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');

  const [nodeProcesses, setNodeProcesses] = useState<NodeProcessInfo[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);

  const [editEmail, setEditEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [llmRateLimit, setLlmRateLimit] = useState<LlmRateLimitStatus>({
    enabled: false,
    requestsPerMinute: 60,
    queuedRequests: 0,
    requestsLastMinute: 0,
    nextRequestInMs: 0,
  });
  const [llmRequestsPerMinute, setLlmRequestsPerMinute] = useState('60');
  const [rateLimitSaved, setRateLimitSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await api.admin.settings();
      setRegistrationEnabled(data.registrationEnabled);
      setLlmRateLimit(data.llmRateLimit);
      setLlmRequestsPerMinute(String(data.llmRateLimit.requestsPerMinute));
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.admin.users();
      setUsers(data.users);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.admin.stats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await api.admin.models();
      setModels(data.models);
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadNodeProcesses = useCallback(async () => {
    setProcessesLoading(true);
    try {
      const data = await api.admin.nodeProcesses();
      setNodeProcesses(data.processes);
    } catch (err) {
      console.error('Failed to load node processes:', err);
    } finally {
      setProcessesLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadUsers(), loadStats(), loadModels(), loadNodeProcesses(), loadSettings()]).finally(() => setLoading(false));
  }, [loadUsers, loadStats, loadModels, loadNodeProcesses, loadSettings]);

  useEffect(() => {
    if (tab !== 'processes') return;
    const interval = setInterval(loadNodeProcesses, 5000);
    return () => clearInterval(interval);
  }, [tab, loadNodeProcesses]);

  useEffect(() => {
    if (selectedUser) {
      setEditEmail(selectedUser.email || '');
      setEmailSaved(false);
      setPasswordSaved(false);
      setShowResetPassword(false);
    }
  }, [selectedUser?.id]);

  const handleAddCredits = async () => {
    if (!selectedUser || !creditAmount) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await api.admin.addCredits(selectedUser.id, amount);
      setCreditAmount('');
      await loadUsers();
      const refreshedUser = (await api.admin.users()).users.find((u: UserPublic) => u.id === selectedUser.id);
      if (refreshedUser) setSelectedUser(refreshedUser);
      const data = await api.admin.creditHistory(selectedUser.id);
      setCreditHistory(data.history);
      setHistoryBalance(data.balance);
    } catch (err) {
      console.error('Failed to add credits:', err);
    }
  };

  const handleViewHistory = async (user: UserPublic) => {
    setSelectedUser(user);
    try {
      const data = await api.admin.creditHistory(user.id);
      setCreditHistory(data.history);
      setHistoryBalance(data.balance);
    } catch (err) {
      console.error('Failed to load credit history:', err);
    }
  };

  const handleChangeRole = async (userId: string, role: 'admin' | 'user') => {
    try {
      await api.admin.changeRole(userId, role);
      await loadUsers();
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita.')) return;
    try {
      await api.admin.deleteUser(userId);
      if (selectedUser?.id === userId) setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleSaveEmail = async () => {
    if (!selectedUser) return;
    try {
      await api.admin.updateUser(selectedUser.id, { email: editEmail || undefined });
      setEmailSaved(true);
      await loadUsers();
      const refreshedUser = (await api.admin.users()).users.find((u: UserPublic) => u.id === selectedUser.id);
      if (refreshedUser) setSelectedUser(refreshedUser);
      setTimeout(() => setEmailSaved(false), 2000);
    } catch (err) {
      console.error('Failed to update email:', err);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !resetPassword || resetPassword.length < 4) return;
    try {
      await api.admin.resetPassword(selectedUser.id, resetPassword);
      setPasswordSaved(true);
      setResetPassword('');
      setShowResetPassword(false);
      setTimeout(() => setPasswordSaved(false), 2000);
    } catch (err) {
      console.error('Failed to reset password:', err);
    }
  };

  const handleToggleModel = async (modelId: string, currentEnabled: boolean) => {
    try {
      await api.admin.updateModel(modelId, { enabled: !currentEnabled });
      await loadModels();
    } catch (err) {
      console.error('Failed to toggle model:', err);
    }
  };

  const handleSaveModelConfig = async (modelId: string) => {
    const cost = parseFloat(editCost);
    if (isNaN(cost) || cost < 0) return;
    try {
      await api.admin.updateModel(modelId, {
        costPerStep: cost,
        displayName: editDisplayName || null,
      });
      setEditingModel(null);
      setEditCost('');
      setEditDisplayName('');
      await loadModels();
    } catch (err) {
      console.error('Failed to save model config:', err);
    }
  };

  const startEditModel = (model: AdminModelInfo) => {
    setEditingModel(model.id);
    setEditCost(String(model.costPerStep));
    setEditDisplayName(model.displayName || '');
  };

  const toggleModelSelection = (modelId: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const toggleSelectAllModels = () => {
    if (selectedModels.size === models.length) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(models.map(m => m.id)));
    }
  };

  const handleBatchUpdateModels = async (enabled: boolean) => {
    if (selectedModels.size === 0) return;
    try {
      await api.admin.batchUpdateModels(Array.from(selectedModels), enabled);
      setSelectedModels(new Set());
      await loadModels();
    } catch (err) {
      console.error('Failed to batch update models:', err);
    }
  };

  const handleStopProcess = async (uuid: string) => {
    try {
      await api.admin.stopNodeProcess(uuid);
      await loadNodeProcesses();
    } catch (err) {
      console.error('Failed to stop node process:', err);
    }
  };

  const handleRestartProcess = async (uuid: string) => {
    try {
      await api.admin.restartNodeProcess(uuid);
      await loadNodeProcesses();
    } catch (err) {
      console.error('Failed to restart node process:', err);
    }
  };

  const handleToggleRegistration = async () => {
    try {
      const data = await api.admin.updateSettings({ registrationEnabled: !registrationEnabled });
      setRegistrationEnabled(data.registrationEnabled);
    } catch (err) {
      console.error('Failed to toggle registration:', err);
    }
  };

  const handleToggleLlmRateLimit = async () => {
    setSettingsLoading(true);
    try {
      const data = await api.admin.updateSettings({ llmRateLimitEnabled: !llmRateLimit.enabled });
      setLlmRateLimit(data.llmRateLimit);
    } catch (err) {
      console.error('Failed to toggle LLM rate limit:', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSaveLlmRateLimit = async () => {
    const requestsPerMinute = Number(llmRequestsPerMinute);
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10000) return;
    setSettingsLoading(true);
    try {
      const data = await api.admin.updateSettings({ llmRequestsPerMinute: requestsPerMinute });
      setLlmRateLimit(data.llmRateLimit);
      setLlmRequestsPerMinute(String(data.llmRateLimit.requestsPerMinute));
      setRateLimitSaved(true);
      setTimeout(() => setRateLimitSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save LLM rate limit:', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Carregando painel administrativo...</div>;
  }

  const tabs: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'users', label: 'Usuários', icon: Users },
    { id: 'models', label: 'Modelos', icon: Cpu },
    { id: 'processes', label: 'Processos', icon: Server },
    { id: 'settings', label: 'Ajustes', icon: Settings },
    { id: 'stats', label: 'Painel', icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col md:flex-row h-full">
      <div className="md:w-48 border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-900/50 p-2 shrink-0">
        <nav className="flex md:block gap-1 overflow-x-auto md:space-y-0.5" aria-label="Seções administrativas">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'shrink-0 md:w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all',
                  tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'users' && (
          <div className="flex flex-col lg:flex-row h-full">
            <ScrollArea className="flex-1 p-4">
              <h2 className="text-sm font-semibold mb-3">Usuários ({users.length})</h2>
              <div className="space-y-1">
                {users.map(u => (
                  <div
                    key={u.id}
                    onClick={() => handleViewHistory(u)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all',
                      selectedUser?.id === u.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    )}
                  >
                    <div className="h-7 w-7 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                      {u.username ? u.username[0].toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200 truncate">{u.username}</div>
                      <div className="text-[10px] text-zinc-500">{u.credits} créditos &middot; {userRoleLabels[u.role] || u.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {selectedUser && (
              <div className="lg:w-80 border-t lg:border-t-0 lg:border-l border-zinc-800 p-4 overflow-y-auto max-h-[48%] lg:max-h-none">
                <h2 className="text-sm font-semibold mb-3">{selectedUser.username}</h2>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Perfil</span>
                    <select
                      value={selectedUser.role}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChangeRole(selectedUser.id, e.target.value as any)}
                      className="bg-zinc-800 text-zinc-200 rounded px-2 py-0.5 text-xs"
                    >
                      <option value="user">usuário</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Créditos</span>
                    <span className="text-zinc-200 font-medium">{selectedUser.credits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Criado em</span>
                    <span className="text-zinc-400">{new Date(selectedUser.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">E-mail</label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        className="text-xs h-8 flex-1"
                      />
                      <Button size="sm" onClick={handleSaveEmail} className="h-8 text-xs">
                        {emailSaved ? 'Salvo' : 'Salvar'}
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Redefinir senha</label>
                    {showResetPassword ? (
                      <div className="space-y-2">
                        <Input
                          type="password"
                          placeholder="Nova senha (mín. 4 caracteres)"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          className="text-xs h-8"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleResetPassword} className="h-8 text-xs text-[11px]" disabled={resetPassword.length < 4}>
                            {passwordSaved ? 'Salvo' : 'Aplicar'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setShowResetPassword(false); setResetPassword(''); }} className="h-8 text-xs">
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setShowResetPassword(true)} className="w-full text-xs h-8">
                        Redefinir senha
                      </Button>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Adicionar créditos</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Quantidade"
                        value={creditAmount}
                        onChange={e => setCreditAmount(e.target.value)}
                        className="text-xs h-8"
                      />
                      <Button size="sm" onClick={handleAddCredits} className="h-8 text-xs">Adicionar</Button>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Histórico de créditos</label>
                    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                      {creditHistory.map(tx => (
                        <div key={tx.id} className="flex justify-between text-[11px] py-1">
                          <span className={tx.amount < 0 ? 'text-red-400' : 'text-green-400'}>
                            {tx.amount < 0 ? '' : '+'}{tx.amount}
                          </span>
                          <span className="text-zinc-500">{tx.type}</span>
                        </div>
                      ))}
                      {creditHistory.length === 0 && (
                        <p className="text-[10px] text-zinc-600">Nenhuma transação</p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleDeleteUser(selectedUser.id)}
                  >
                    Excluir usuário
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'models' && (
          <ScrollArea className="h-full p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Gerenciamento de modelos</h2>
              <span className="text-[10px] text-zinc-500">{models.length} modelos disponíveis</span>
            </div>

            {selectedModels.size > 0 && (
              <div className="flex items-center gap-2 mb-3 p-2 bg-zinc-800/50 rounded-md">
                <span className="text-[11px] text-zinc-400">{selectedModels.size} selecionado(s)</span>
                <Button size="sm" className="h-6 text-[10px] text-emerald-400" onClick={() => handleBatchUpdateModels(true)}>
                  Ativar
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] text-red-400" onClick={() => handleBatchUpdateModels(false)}>
                  Desativar
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSelectedModels(new Set())}>
                  Limpar
                </Button>
              </div>
            )}

            {modelsLoading ? (
              <div className="text-zinc-500 text-xs">Carregando modelos...</div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[28px_1fr_80px_80px_80px_60px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  <button onClick={toggleSelectAllModels} className="flex items-center justify-center cursor-pointer" title={selectedModels.size === models.length ? 'Desmarcar todos' : 'Selecionar todos'}>
                    {selectedModels.size === models.length ? <CheckSquare className="h-3.5 w-3.5" /> : <SquareBox className="h-3.5 w-3.5" />}
                  </button>
                  <span>Modelo</span>
                  <span>Custo/etapa</span>
                  <span>Status</span>
                  <span>Nome público</span>
                  <span>Ações</span>
                </div>

                {models.map(model => (
                  <div
                    key={model.id}
                    className={cn(
                      'grid grid-cols-[28px_1fr_80px_80px_80px_60px] gap-2 px-3 py-2.5 rounded-md items-center text-xs',
                      model.enabled ? 'bg-zinc-900/50' : 'bg-zinc-900/30 opacity-60',
                      model.offline && 'border border-yellow-500/30',
                      selectedModels.has(model.id) && 'ring-1 ring-blue-500/40'
                    )}
                  >
                    <button onClick={() => toggleModelSelection(model.id)} className="flex items-center justify-center cursor-pointer">
                      {selectedModels.has(model.id) ? <CheckSquare className="h-3.5 w-3.5 text-blue-400" /> : <SquareBox className="h-3.5 w-3.5 text-zinc-600" />}
                    </button>

                    <div className="min-w-0">
                      <div className="font-mono text-zinc-200 truncate text-[11px]">{model.id}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{model.name !== model.id ? model.name : ''}</div>
                      {model.offline && <span className="text-[9px] text-yellow-500">offline</span>}
                    </div>

                    {editingModel === model.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          value={editCost}
                          onChange={e => setEditCost(e.target.value)}
                          className="h-6 text-[11px] w-16 px-1"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <span className="text-zinc-300 text-[11px] font-medium">
                        {model.costPerStep} cr
                      </span>
                    )}

                    <div>
                      <button
                        onClick={() => handleToggleModel(model.id, model.enabled)}
                        className={cn(
                          'flex items-center gap-1 text-[11px] transition-colors',
                          model.enabled ? 'text-emerald-400' : 'text-red-400'
                        )}
                        title={model.enabled ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
                      >
                        {model.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                        {model.enabled ? 'Ativo' : 'Inativo'}
                      </button>
                    </div>

                    {editingModel === model.id ? (
                      <Input
                        value={editDisplayName}
                        onChange={e => setEditDisplayName(e.target.value)}
                        placeholder="Nome público"
                        className="h-6 text-[11px] w-full px-1"
                      />
                    ) : (
                      <span className="text-zinc-400 text-[11px] truncate">
                        {model.displayName || '—'}
                      </span>
                    )}

                    <div className="flex gap-1">
                      {editingModel === model.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-emerald-400"
                            onClick={() => handleSaveModelConfig(model.id)}
                          >
                            Salvar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => setEditingModel(null)}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => startEditModel(model)}
                        >
                          Editar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}

        {tab === 'processes' && (
          <ScrollArea className="h-full p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Processos Node.js</h2>
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={loadNodeProcesses} disabled={processesLoading}>
                <RefreshCw className={cn('h-3 w-3 mr-1', processesLoading && 'animate-spin')} />
                Atualizar
              </Button>
            </div>

            {nodeProcesses.length === 0 ? (
              <div className="text-zinc-500 text-xs text-center py-8">
                <Server className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                <p>Nenhum processo Node.js em execução</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_80px_60px_80px_80px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  <span>Projeto</span>
                  <span>Usuário</span>
                  <span>Porta</span>
                  <span>Status</span>
                  <span>Ações</span>
                </div>

                {nodeProcesses.map(proc => (
                  <div
                    key={proc.uuid}
                    className="grid grid-cols-[1fr_80px_60px_80px_80px] gap-2 px-3 py-2.5 rounded-md items-center text-xs bg-zinc-900/50"
                  >
                    <div className="min-w-0">
                      <div className="text-zinc-200 truncate text-[11px] font-medium">{proc.name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{proc.uuid.slice(0, 8)}</div>
                    </div>
                    <span className="text-zinc-400 text-[11px] truncate">{proc.username || '—'}</span>
                    <span className="text-zinc-300 text-[11px] font-mono">{proc.port}</span>
                    <div>
                      <span className={cn(
                        'text-[11px] px-1.5 py-0.5 rounded-full',
                        proc.status === 'running' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
                      )}>
                        {processStatusLabels[proc.status] || proc.status}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {proc.status === 'running' && (
                        <button
                          onClick={() => handleStopProcess(proc.uuid)}
                          className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                          title="Parar processo"
                        >
                          <Square className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRestartProcess(proc.uuid)}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                        title="Reiniciar processo"
                      >
                        <RotateCw className="h-3 w-3 text-blue-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}

        {tab === 'settings' && (
          <ScrollArea className="h-full p-4">
            <h2 className="text-sm font-semibold mb-4">Ajustes</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
                <div>
                  <div className="text-xs font-medium text-zinc-200">Cadastro de usuários</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {registrationEnabled
                      ? 'Novos usuários podem criar contas'
                      : 'O cadastro está desativado — novos usuários não podem se registrar'}
                  </div>
                </div>
                <button
                  onClick={handleToggleRegistration}
                  disabled={settingsLoading}
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium transition-colors',
                    registrationEnabled ? 'text-emerald-400' : 'text-red-400'
                  )}
                  title={registrationEnabled ? 'Clique para desativar o cadastro' : 'Clique para ativar o cadastro'}
                >
                  {registrationEnabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                  {registrationEnabled ? 'Ativo' : 'Inativo'}
                </button>
              </div>

              <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Limite global da API de IA</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      Distribui as chamadas em uma fila FIFO e evita rajadas no provedor
                    </div>
                  </div>
                  <button
                    onClick={handleToggleLlmRateLimit}
                    disabled={settingsLoading}
                    className={cn(
                      'flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0',
                      llmRateLimit.enabled ? 'text-emerald-400' : 'text-zinc-500'
                    )}
                    title={llmRateLimit.enabled ? 'Clique para desativar o limite' : 'Clique para ativar o limite'}
                  >
                    {llmRateLimit.enabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                    {llmRateLimit.enabled ? 'Ativo' : 'Inativo'}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="llm-requests-per-minute" className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Requisições por minuto
                  </label>
                  <div className="flex gap-2 max-w-sm">
                    <Input
                      id="llm-requests-per-minute"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={llmRequestsPerMinute}
                      onChange={event => setLlmRequestsPerMinute(event.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs min-w-20"
                      onClick={handleSaveLlmRateLimit}
                      disabled={settingsLoading || !Number.isInteger(Number(llmRequestsPerMinute)) || Number(llmRequestsPerMinute) < 1 || Number(llmRequestsPerMinute) > 10000}
                    >
                      {rateLimitSaved ? 'Salvo' : 'Salvar'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={loadSettings} disabled={settingsLoading} title="Atualizar estado da fila">
                      <RefreshCw className={cn('h-3.5 w-3.5', settingsLoading && 'animate-spin')} />
                    </Button>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    As chamadas são espaçadas em aproximadamente {Math.max(1, Math.ceil(60000 / Math.max(1, llmRateLimit.requestsPerMinute))).toLocaleString('pt-BR')} ms.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="rounded-md bg-zinc-950/60 px-3 py-2">
                    <div className="text-[9px] uppercase text-zinc-600">Na fila</div>
                    <div className="text-sm font-semibold text-amber-400">{llmRateLimit.queuedRequests}</div>
                  </div>
                  <div className="rounded-md bg-zinc-950/60 px-3 py-2">
                    <div className="text-[9px] uppercase text-zinc-600">Último minuto</div>
                    <div className="text-sm font-semibold text-blue-400">{llmRateLimit.requestsLastMinute}</div>
                  </div>
                  <div className="rounded-md bg-zinc-950/60 px-3 py-2 col-span-2 md:col-span-1">
                    <div className="text-[9px] uppercase text-zinc-600">Próxima chamada</div>
                    <div className="text-sm font-semibold text-zinc-300">
                      {llmRateLimit.nextRequestInMs > 0 ? `${(llmRateLimit.nextRequestInMs / 1000).toFixed(1)} s` : 'agora'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        {tab === 'stats' && stats && (
          <ScrollArea className="h-full p-4">
            <h2 className="text-sm font-semibold mb-4">Painel</h2>

            <div className="grid grid-cols-4 gap-3 mb-6">
              <StatCard label="Total de usuários" value={stats.totalUsers} color="blue" />
              <StatCard label="Projetos ativos" value={stats.activeProjects} color="emerald" />
              <StatCard label="Total de tarefas" value={stats.totalTasks} color="purple" />
              <StatCard label="Tarefas em execução" value={stats.runningTasks} color="amber" />
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="Créditos concedidos" value={stats.totalCreditsGranted} color="green" />
              <StatCard label="Créditos usados" value={stats.totalCreditsUsed} color="red" />
              <StatCard label="Etapas do agente" value={stats.totalSteps} color="cyan" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total de projetos" value={stats.totalProjects} color="emerald" />
              <StatCard
                label="Média de créditos/usuário"
                value={stats.totalUsers > 0 ? Math.round((stats.totalCreditsGranted / stats.totalUsers) * 10) / 10 : 0}
                color="blue"
              />
            </div>

            {users.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-zinc-400 mb-3">Usuários com mais créditos</h3>
                <div className="space-y-1">
                  {[...users].sort((a, b) => b.credits - a.credits).slice(0, 5).map((u, i) => (
                    <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <span className="text-zinc-500 w-4 text-right">{i + 1}.</span>
                      <span className="text-zinc-200 flex-1">{u.username}</span>
                      <span className={cn('font-medium', u.credits > 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {u.credits.toLocaleString()} cr
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'border-blue-500/20 text-blue-400',
    emerald: 'border-emerald-500/20 text-emerald-400',
    purple: 'border-purple-500/20 text-purple-400',
    amber: 'border-amber-500/20 text-amber-400',
    green: 'border-green-500/20 text-green-400',
    red: 'border-red-500/20 text-red-400',
    cyan: 'border-cyan-500/20 text-cyan-400',
  };
  return (
    <div className={cn('bg-zinc-900 border rounded-lg p-3', colorClasses[color] || 'border-zinc-800')}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</div>
      <div className="text-lg font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}
