import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Globe } from 'lucide-react';

export default function LoginPage() {
  const { login, register, isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState(true);

  useEffect(() => {
    fetch('/api/auth/registration-status')
      .then(r => r.json())
      .then(data => setRegistrationEnabled(data.registrationEnabled))
      .catch(() => setRegistrationEnabled(true));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        if (!email.trim()) {
          setError('Informe seu e-mail para criar a conta.');
          return;
        }
        await register(username, password, email.trim());
      }
    } catch (err: any) {
      const msg = err.message || 'Falha na autenticação';
      if (msg.includes('403') || msg.includes('Registration is currently disabled')) {
        setError('O cadastro está desativado por um administrador.');
      } else if (msg.includes('Invalid credentials')) {
        setError('Usuário ou senha inválidos.');
      } else {
        setError(msg);
      }
    }
  };

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center bg-transparent text-zinc-100 p-4 sm:p-8">
      <div className="w-full max-w-md p-6 sm:p-9 bg-zinc-900/85 rounded-3xl border border-zinc-800/80 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-inner">
            <Globe className="h-4.5 w-4.5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Web Agent</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Seu ambiente de desenvolvimento com IA</p>
          </div>
        </div>

        <div className="flex mb-7 bg-zinc-950/60 border border-zinc-800 rounded-xl p-1" role="tablist" aria-label="Acesso à conta">
          <button
            onClick={() => { setMode('login'); setError(''); }}
            role="tab" aria-selected={mode === 'login'}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
              mode === 'login' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Entrar
          </button>
          {registrationEnabled && (
            <button
              onClick={() => { setMode('register'); setError(''); }}
              role="tab" aria-selected={mode === 'register'}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                mode === 'register' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Criar conta
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5"><label htmlFor="username" className="text-xs font-medium text-zinc-300">Usuário</label>
          <Input
            id="username" autoComplete="username" placeholder="Digite seu usuário"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            disabled={isLoading}
          /></div>
          <div className="space-y-1.5"><label htmlFor="password" className="text-xs font-medium text-zinc-300">Senha</label>
          <Input
            id="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            type="password"
            placeholder="Digite sua senha"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isLoading}
          /></div>
          {mode === 'register' && (
            <div className="space-y-1.5"><label htmlFor="email" className="text-xs font-medium text-zinc-300">E-mail</label><Input
              id="email" autoComplete="email"
              type="email"
              placeholder="voce@exemplo.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={isLoading}
            /></div>
          )}

          {error && (
            <div className="text-sm text-red-300 bg-red-400/10 border border-red-400/20 rounded-lg py-2.5 px-3" role="alert">{error}</div>
          )}

          <Button
            type="submit"
            className="w-full h-11 rounded-xl mt-2"
            disabled={isLoading || !username || !password || (mode === 'register' && !email.trim())}
          >
            {isLoading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </Button>
        </form>
      </div>
    </div>
  );
}
