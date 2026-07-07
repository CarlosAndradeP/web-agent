import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authApi, type CreditTransaction, type PixPayment } from '../lib/auth-api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { User, Lock, CreditCard, Save, AlertCircle, QrCode, Copy, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

type AccountTab = 'account' | 'security' | 'credits';

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  user: 'Usuário',
};

export default function UserPanel({ initialTab = 'account' }: { initialTab?: AccountTab }) {
  const { user, accessToken, updateCredits, updateUser } = useAuth();
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [creditHistory, setCreditHistory] = useState<CreditTransaction[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [pixEnabled, setPixEnabled] = useState(false);
  const [creditPriceBrl, setCreditPriceBrl] = useState(1);
  const [pixCredits, setPixCredits] = useState('50');
  const [pixPayment, setPixPayment] = useState<PixPayment | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState('');
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
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!accessToken) return;
    authApi.paymentConfig(accessToken)
      .then(data => {
        setPixEnabled(data.pixEnabled);
        setCreditPriceBrl(data.creditPriceBrl);
      })
      .catch(() => {});
    authApi.pixPayments(accessToken)
      .then(data => {
        setPixPayment(data.payments.find(payment => payment.status !== 'approved' && payment.status !== 'cancelled' && payment.status !== 'rejected') || data.payments[0] || null);
      })
      .catch(() => {});
  }, [accessToken]);

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

  const handleCreatePixPayment = async () => {
    if (!accessToken) return;
    const credits = Math.floor(Number(pixCredits));
    if (!Number.isFinite(credits) || credits < 1) {
      setPixError('Informe uma quantidade válida de créditos');
      return;
    }
    setPixLoading(true);
    setPixError('');
    try {
      const data = await authApi.createPixPayment(credits, accessToken);
      setPixPayment(data.payment);
    } catch {
      setPixError('Não foi possível gerar o Pix agora');
    } finally {
      setPixLoading(false);
    }
  };

  const handleRefreshPixPayment = async () => {
    if (!accessToken || !pixPayment) return;
    setPixLoading(true);
    setPixError('');
    try {
      const data = await authApi.pixPayment(pixPayment.id, accessToken);
      setPixPayment(data.payment);
      if (data.payment.creditedAt) {
        await loadCreditHistory();
      }
    } catch {
      setPixError('Não foi possível atualizar o status');
    } finally {
      setPixLoading(false);
    }
  };

  const handleCopyPixCode = async () => {
    if (!pixPayment?.qrCode) return;
    await navigator.clipboard.writeText(pixPayment.qrCode);
  };

  if (!user) return null;

  const tabs: { id: AccountTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'account', label: 'Conta', icon: User },
    { id: 'security', label: 'Segurança', icon: Lock },
    { id: 'credits', label: 'Créditos', icon: CreditCard },
  ];
  const pixCreditCount = Math.max(0, Math.floor(Number(pixCredits) || 0));
  const pixAmount = pixCreditCount * creditPriceBrl;
  const pixStatusLabels: Record<string, string> = {
    pending: 'Aguardando pagamento',
    approved: 'Aprovado',
    rejected: 'Recusado',
    cancelled: 'Cancelado',
    error: 'Erro',
  };

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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Comprar com Pix</label>
                  <span className={cn('text-[10px]', pixEnabled ? 'text-emerald-400' : 'text-zinc-600')}>
                    {pixEnabled ? `R$ ${creditPriceBrl.toFixed(2).replace('.', ',')} por crédito` : 'Indisponível'}
                  </span>
                </div>

                {pixEnabled && (
                  <>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={pixCredits}
                        onChange={e => { setPixCredits(e.target.value); setPixError(''); }}
                        className="text-xs"
                        placeholder="Créditos"
                      />
                      <Button size="sm" onClick={handleCreatePixPayment} disabled={pixLoading} className="h-9 text-xs gap-1">
                        <QrCode className="h-3 w-3" /> Gerar Pix
                      </Button>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Total: R$ {pixAmount.toFixed(2).replace('.', ',')}
                    </div>
                  </>
                )}

                {pixError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle className="h-3 w-3" />
                    {pixError}
                  </div>
                )}

                {pixPayment && (
                  <div className="border border-zinc-800 rounded-lg p-3 space-y-3 bg-zinc-950">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs text-zinc-200">{pixPayment.credits.toLocaleString()} créditos</div>
                        <div className="text-[10px] text-zinc-500">R$ {pixPayment.amountBrl.toFixed(2).replace('.', ',')}</div>
                      </div>
                      <div className={cn(
                        'text-[10px] font-medium',
                        pixPayment.status === 'approved' ? 'text-emerald-400' : 'text-amber-400'
                      )}>
                        {pixStatusLabels[pixPayment.status] || pixPayment.status}
                      </div>
                    </div>

                    {pixPayment.qrCodeBase64 && pixPayment.status !== 'approved' && (
                      <img
                        src={`data:image/png;base64,${pixPayment.qrCodeBase64}`}
                        alt="QR Code Pix"
                        className="h-44 w-44 rounded-md bg-white p-2 mx-auto"
                      />
                    )}

                    {pixPayment.qrCode && pixPayment.status !== 'approved' && (
                      <div className="space-y-2">
                        <textarea
                          readOnly
                          value={pixPayment.qrCode}
                          className="w-full min-h-20 resize-none rounded-md border border-zinc-800 bg-zinc-900 p-2 text-[10px] text-zinc-400 outline-none"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={handleCopyPixCode} className="h-8 text-xs gap-1">
                            <Copy className="h-3 w-3" /> Copiar código
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleRefreshPixPayment} disabled={pixLoading} className="h-8 text-xs gap-1">
                            <RefreshCw className="h-3 w-3" /> Atualizar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
