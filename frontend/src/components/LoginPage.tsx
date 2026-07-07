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
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-sm p-8 bg-zinc-900 rounded-2xl border border-zinc-800/60 shadow-xl">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-9 w-9 rounded-xl bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
            <Globe className="h-4.5 w-4.5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Web Agent</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">Crie, edite e publique projetos web com IA</p>
          </div>
        </div>

        <div className="flex mb-6 bg-zinc-800/80 rounded-lg p-1">
          <button
            onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
              mode === 'login' ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Entrar
          </button>
          {registrationEnabled && (
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                mode === 'register' ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Criar conta
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            placeholder="Usuário"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            disabled={isLoading}
          />
          <Input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isLoading}
          />
          {mode === 'register' && (
            <Input
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          )}

          {error && (
            <div className="text-xs text-red-400 text-center bg-red-400/10 rounded-lg py-2 px-3">{error}</div>
          )}

          <Button
            type="submit"
            className="w-full rounded-lg"
            disabled={isLoading || !username || !password || (mode === 'register' && !email.trim())}
          >
            {isLoading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </Button>
        </form>
      </div>
    </div>
  );
}
