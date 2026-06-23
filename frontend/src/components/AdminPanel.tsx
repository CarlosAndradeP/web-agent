import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { UserPublic, CreditTransaction, AdminModelInfo, NodeProcessInfo } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Users, CreditCard, BarChart3, Cpu, ToggleLeft, ToggleRight, Server, Square, RotateCw, RefreshCw, CheckSquare, Square as SquareBox } from 'lucide-react';
import { cn } from '../lib/utils';

type AdminTab = 'users' | 'models' | 'processes' | 'stats';

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
    Promise.all([loadUsers(), loadStats(), loadModels(), loadNodeProcesses()]).finally(() => setLoading(false));
  }, [loadUsers, loadStats, loadModels, loadNodeProcesses]);

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
    if (!confirm('Are you sure you want to delete this user?')) return;
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

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading admin panel...</div>;
  }

  const tabs: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'processes', label: 'Processes', icon: Server },
    { id: 'stats', label: 'Dashboard', icon: BarChart3 },
  ];

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-zinc-800 bg-zinc-900/50 p-2">
        <nav className="space-y-0.5">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all',
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
          <div className="flex h-full">
            <ScrollArea className="flex-1 p-4">
              <h2 className="text-sm font-semibold mb-3">Users ({users.length})</h2>
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
                      <div className="text-[10px] text-zinc-500">{u.credits} credits &middot; {u.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {selectedUser && (
              <div className="w-80 border-l border-zinc-800 p-4 overflow-y-auto">
                <h2 className="text-sm font-semibold mb-3">{selectedUser.username}</h2>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Role</span>
                    <select
                      value={selectedUser.role}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChangeRole(selectedUser.id, e.target.value as any)}
                      className="bg-zinc-800 text-zinc-200 rounded px-2 py-0.5 text-xs"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Credits</span>
                    <span className="text-zinc-200 font-medium">{selectedUser.credits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Created</span>
                    <span className="text-zinc-400">{new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Email</label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        className="text-xs h-8 flex-1"
                      />
                      <Button size="sm" onClick={handleSaveEmail} className="h-8 text-xs">
                        {emailSaved ? 'Saved' : 'Save'}
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Reset Password</label>
                    {showResetPassword ? (
                      <div className="space-y-2">
                        <Input
                          type="password"
                          placeholder="New password (min 4 chars)"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          className="text-xs h-8"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleResetPassword} className="h-8 text-xs text-[11px]" disabled={resetPassword.length < 4}>
                            {passwordSaved ? 'Saved' : 'Apply'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setShowResetPassword(false); setResetPassword(''); }} className="h-8 text-xs">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setShowResetPassword(true)} className="w-full text-xs h-8">
                        Reset Password
                      </Button>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Add Credits</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Amount"
                        value={creditAmount}
                        onChange={e => setCreditAmount(e.target.value)}
                        className="text-xs h-8"
                      />
                      <Button size="sm" onClick={handleAddCredits} className="h-8 text-xs">Add</Button>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Credit History</label>
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
                        <p className="text-[10px] text-zinc-600">No transactions</p>
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
                    Delete User
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'models' && (
          <ScrollArea className="h-full p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Model Management</h2>
              <span className="text-[10px] text-zinc-500">{models.length} models available</span>
            </div>

            {selectedModels.size > 0 && (
              <div className="flex items-center gap-2 mb-3 p-2 bg-zinc-800/50 rounded-md">
                <span className="text-[11px] text-zinc-400">{selectedModels.size} selected</span>
                <Button size="sm" className="h-6 text-[10px] text-emerald-400" onClick={() => handleBatchUpdateModels(true)}>
                  Enable
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] text-red-400" onClick={() => handleBatchUpdateModels(false)}>
                  Disable
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSelectedModels(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {modelsLoading ? (
              <div className="text-zinc-500 text-xs">Loading models...</div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[28px_1fr_80px_80px_80px_60px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  <button onClick={toggleSelectAllModels} className="flex items-center justify-center cursor-pointer" title={selectedModels.size === models.length ? 'Deselect all' : 'Select all'}>
                    {selectedModels.size === models.length ? <CheckSquare className="h-3.5 w-3.5" /> : <SquareBox className="h-3.5 w-3.5" />}
                  </button>
                  <span>Model</span>
                  <span>Cost/Step</span>
                  <span>Status</span>
                  <span>Display Name</span>
                  <span>Actions</span>
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
                        title={model.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                      >
                        {model.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                        {model.enabled ? 'On' : 'Off'}
                      </button>
                    </div>

                    {editingModel === model.id ? (
                      <Input
                        value={editDisplayName}
                        onChange={e => setEditDisplayName(e.target.value)}
                        placeholder="Display name"
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
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => setEditingModel(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => startEditModel(model)}
                        >
                          Edit
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
              <h2 className="text-sm font-semibold">Node.js Processes</h2>
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={loadNodeProcesses} disabled={processesLoading}>
                <RefreshCw className={cn('h-3 w-3 mr-1', processesLoading && 'animate-spin')} />
                Refresh
              </Button>
            </div>

            {nodeProcesses.length === 0 ? (
              <div className="text-zinc-500 text-xs text-center py-8">
                <Server className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                <p>No Node.js processes running</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_80px_60px_80px_80px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  <span>Project</span>
                  <span>User</span>
                  <span>Port</span>
                  <span>Status</span>
                  <span>Actions</span>
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
                        {proc.status}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {proc.status === 'running' && (
                        <button
                          onClick={() => handleStopProcess(proc.uuid)}
                          className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                          title="Stop process"
                        >
                          <Square className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRestartProcess(proc.uuid)}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 transition-all"
                        title="Restart process"
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

        {tab === 'stats' && stats && (
          <ScrollArea className="h-full p-4">
            <h2 className="text-sm font-semibold mb-4">Dashboard</h2>

            <div className="grid grid-cols-4 gap-3 mb-6">
              <StatCard label="Total Users" value={stats.totalUsers} color="blue" />
              <StatCard label="Active Projects" value={stats.activeProjects} color="emerald" />
              <StatCard label="Total Tasks" value={stats.totalTasks} color="purple" />
              <StatCard label="Running Tasks" value={stats.runningTasks} color="amber" />
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="Credits Granted" value={stats.totalCreditsGranted} color="green" />
              <StatCard label="Credits Used" value={stats.totalCreditsUsed} color="red" />
              <StatCard label="Agent Steps" value={stats.totalSteps} color="cyan" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Projects" value={stats.totalProjects} color="emerald" />
              <StatCard
                label="Avg Credits/User"
                value={stats.totalUsers > 0 ? Math.round((stats.totalCreditsGranted / stats.totalUsers) * 10) / 10 : 0}
                color="blue"
              />
            </div>

            {users.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-zinc-400 mb-3">Top Users by Credits</h3>
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
