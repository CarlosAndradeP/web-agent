import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authApi, type CreditTransaction } from '../lib/auth-api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { User, Lock, CreditCard, Save, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

type AccountTab = 'account' | 'security' | 'credits';

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  user: 'Usuário',
};

export default function UserPanel() {
  const { user, accessToken, updateCredits, updateUser } = useAuth();
  const [tab, setTab] = useState<AccountTab>('account');
  const [creditHistory, setCreditHistory] = useState<CreditTransaction[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [email, setEmail] = useState(user?.email || '');
  const [profileSuccess, setProfileSuccess] = useState(false);

  const loadCreditHistory = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await authApi.creditHistory(accessToken);
      setCreditHistory(data.history);
      setCreditBalance(data.balance);
    } catch {}
  }, [accessToken]);

  useEffect(() => {
    loadCreditHistory();
  }, [loadCreditHistory]);

  useEffect(() => {
    if (user) {
      setCreditBalance(user.credits);
    }
  }, [user?.credits]);

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess(false);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Preencha todos os campos');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('A nova senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As novas senhas não conferem');
      return;
    }
    try {
      if (!accessToken) return;
      await authApi.changePassword(currentPassword, newPassword, accessToken);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      if (err.message?.includes('incorrect')) {
        setPasswordError('A senha atual está incorreta');
      } else {
        setPasswordError('Não foi possível alterar a senha');
      }
    }
  };

  const handleUpdateProfile = async () => {
    if (!accessToken) return;
    try {
      const data = await authApi.updateProfile({ email: email || null }, accessToken);
      if (data.user) {
        updateUser(data.user);
      }
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch {}
  };

  if (!user) return null;

  const tabs: { id: AccountTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'account', label: 'Conta', icon: User },
    { id: 'security', label: 'Segurança', icon: Lock },
    { id: 'credits', label: 'Créditos', icon: CreditCard },
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
        {tab === 'account' && (
          <ScrollArea className="h-full p-6">
            <h2 className="text-sm font-semibold mb-4">Informações da conta</h2>
            <div className="max-w-md space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Usuário</label>
                <div className="text-sm text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2">{user.username}</div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Perfil</label>
                <div className="text-sm text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2">{roleLabels[user.role] || user.role}</div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">E-mail</label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Criada em</label>
                <div className="text-sm text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2">
                  {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                </div>
              </div>
              <Button size="sm" onClick={handleUpdateProfile} className="text-xs gap-1">
                <Save className="h-3 w-3" /> Salvar e-mail
              </Button>
              {profileSuccess && (
                <p className="text-xs text-emerald-400">Perfil atualizado com sucesso</p>
              )}
            </div>
          </ScrollArea>
        )}

        {tab === 'security' && (
          <ScrollArea className="h-full p-6">
            <h2 className="text-sm font-semibold mb-4">Alterar senha</h2>
            <div className="max-w-md space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Senha atual</label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={e => { setCurrentPassword(e.target.value); setPasswordError(''); }}
                  className="text-xs"
                  placeholder="Digite a senha atual"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Nova senha</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setPasswordError(''); }}
                  className="text-xs"
                  placeholder="Pelo menos 6 caracteres"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">Confirmar nova senha</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                  className="text-xs"
                  placeholder="Repita a nova senha"
                  onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                />
              </div>
              {passwordError && (
                <div className="flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle className="h-3 w-3" />
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <p className="text-xs text-emerald-400">Senha alterada com sucesso</p>
              )}
              <Button size="sm" onClick={handleChangePassword} className="text-xs gap-1">
                <Lock className="h-3 w-3" /> Alterar senha
              </Button>
            </div>
          </ScrollArea>
        )}

        {tab === 'credits' && (
          <ScrollArea className="h-full p-6">
            <h2 className="text-sm font-semibold mb-4">Créditos</h2>
            <div className="max-w-md space-y-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Saldo atual</div>
                <div className="text-2xl font-bold text-zinc-100 mt-1">{creditBalance.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500 mt-1">créditos</div>
              </div>

              <Separator />

              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-2">Histórico de transações</label>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {creditHistory.map(tx => (
                    <div key={tx.id} className="flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-zinc-800/50">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'font-medium',
                          tx.amount < 0 ? 'text-red-400' : 'text-green-400'
                        )}>
                          {tx.amount < 0 ? '' : '+'}{tx.amount}
                        </span>
                        <span className="text-zinc-500">{tx.type}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">{tx.description || '—'}</span>
                        <span className="text-zinc-600 text-[10px]">{new Date(tx.createdAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <span className="text-zinc-400 font-mono text-[10px]">{tx.balanceAfter}</span>
                    </div>
                  ))}
                  {creditHistory.length === 0 && (
                    <p className="text-[10px] text-zinc-600 py-2">Nenhuma transação ainda</p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
