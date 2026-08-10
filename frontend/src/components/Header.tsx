import { Menu, X, Globe } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  onMenuToggle: () => void;
  menuOpen: boolean;
  isRunning: boolean;
  sessionName?: string;
}

export default function Header({ onMenuToggle, menuOpen, isRunning, sessionName }: Props) {
  return (
    <header className="md:hidden h-14 flex items-center gap-3 px-3 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-xl safe-top">
      <Button variant="ghost" size="icon" onClick={onMenuToggle} className="h-10 w-10 shrink-0" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen}>
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <Globe className="h-4 w-4 text-blue-400 shrink-0" />
        {isRunning && (
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        )}
        <div className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-100 truncate">{sessionName || 'Web Agent'}</span>
          <span className="block text-[11px] text-zinc-500">{isRunning ? 'Agente trabalhando' : 'Pronto para criar'}</span>
        </div>
      </div>
    </header>
  );
}
