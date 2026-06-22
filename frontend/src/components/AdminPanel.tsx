import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { UserPublic, CreditTransaction } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Users, CreditCard, BarChart3 } from 'lucide-react';
import { cn } from '../lib/utils';

type AdminTab = 'users' | 'projects' | 'stats';

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserPublic | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditHistory, setCreditHistory] = useState<CreditTransaction[]>([]);
  const [historyBalance, setHistoryBalance] = useState(0);

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

  useEffect(() => {
    setLoading(true);
    loadUsers().then(() => loadStats()).then(() => setLoading(false));
  }, [loadUsers, loadStats]);

  const handleAddCredits = async () => {
    if (!selectedUser || !creditAmount) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await api.admin.addCredits(selectedUser.id, amount);
      setCreditAmount('');
      loadUsers();
      if (selectedUser) {
        const data = await api.admin.creditHistory(selectedUser.id);
        setCreditHistory(data.history);
        setHistoryBalance(data.balance);
      }
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
      loadUsers();
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await api.admin.deleteUser(userId);
      if (selectedUser?.id === userId) setSelectedUser(null);
      loadUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading admin panel...</div>;
  }

  const tabs: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'stats', label: 'Statistics', icon: BarChart3 },
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
                      {u.username[0].toUpperCase()}
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

        {tab === 'stats' && stats && (
          <div className="p-4">
            <h2 className="text-sm font-semibold mb-4">Platform Statistics</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Total Users" value={stats.totalUsers} />
              <StatCard label="Total Projects" value={stats.totalProjects} />
              <StatCard label="Total Tasks" value={stats.totalTasks} />
              <StatCard label="Credits Used" value={stats.totalCreditsUsed} />
              <StatCard label="Credits Granted" value={stats.totalCreditsGranted} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</div>
      <div className="text-lg font-bold text-zinc-100 mt-1">{value.toLocaleString()}</div>
    </div>
  );
}
