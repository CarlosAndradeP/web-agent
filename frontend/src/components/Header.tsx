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
    <header className="md:hidden h-12 flex items-center gap-3 px-3 border-b border-zinc-800/60 bg-zinc-900/80 backdrop-blur-md">
      <Button variant="ghost" size="icon" onClick={onMenuToggle} className="h-8 w-8 shrink-0">
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <Globe className="h-4 w-4 text-blue-400 shrink-0" />
        {isRunning && (
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        )}
        <span className="text-sm font-medium text-zinc-200 truncate">{sessionName || 'Web Agent'}</span>
      </div>
    </header>
  );
}
