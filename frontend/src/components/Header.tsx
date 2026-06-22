import { Menu, X } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  onMenuToggle: () => void;
  menuOpen: boolean;
  isRunning: boolean;
  sessionName?: string;
}

export default function Header({ onMenuToggle, menuOpen, isRunning, sessionName }: Props) {
  return (
    <header className="md:hidden h-12 flex items-center gap-3 px-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
      <Button variant="ghost" size="icon" onClick={onMenuToggle} className="h-8 w-8">
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>
      {isRunning && (
        <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
      )}
      <span className="text-sm font-medium text-zinc-200 truncate">{sessionName || 'Web Agent'}</span>
    </header>
  );
}
