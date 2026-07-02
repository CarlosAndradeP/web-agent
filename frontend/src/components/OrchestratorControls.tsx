import { useState, useRef } from 'react';
import type { OrchestratorStatusInfo } from '../types';
import { Play, Pause, Square, Upload, BrainCircuit, Shield, FileCode, Code, Eye } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface Props {
  status: OrchestratorStatusInfo | null;
  isLoading: boolean;
  onStart: (objective: string, mdFiles?: File[]) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onUploadMd: (files: File[]) => void;
}

const AGENT_BADGES = [
  { role: 'orchestrator', label: 'GLM-5.2', icon: BrainCircuit, color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  { role: 'auxiliar', label: 'Nemotron', icon: Shield, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  { role: 'arquiteto', label: 'GLM-5.2', icon: FileCode, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { role: 'programador', label: 'DeepSeek', icon: Code, color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  { role: 'revisor', label: 'GLM-5.2', icon: Eye, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
];

export default function OrchestratorControls({ status, isLoading, onStart, onStop, onPause, onResume, onUploadMd }: Props) {
  const [objective, setObjective] = useState('');
  const [pendingMdFiles, setPendingMdFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRunning = status?.isRunning ?? false;
  const isPaused = status?.session?.status === 'paused';
  const sessionStatus = status?.session?.status;

  const handleStart = () => {
    if (!objective.trim()) return;
    onStart(objective.trim(), pendingMdFiles.length > 0 ? pendingMdFiles : undefined);
    setPendingMdFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isRunning && objective.trim()) {
      handleStart();
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      if (isRunning || isPaused) {
        onUploadMd(fileArray);
      } else {
        setPendingMdFiles(prev => [...prev, ...fileArray]);
      }
      e.target.value = '';
    }
  };

  const removePendingFile = (index: number) => {
    setPendingMdFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="px-3 py-3 border-t border-zinc-800/60 space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {AGENT_BADGES.map(badge => {
          const Icon = badge.icon;
          const active = isRunning || (badge.role === 'orchestrator' && isRunning);
          return (
            <div key={badge.role} className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border',
              badge.color,
              !active && 'opacity-40'
            )}>
              <Icon className="h-3 w-3" />
              {badge.label}
            </div>
          );
        })}
      </div>

      {!isRunning && !isPaused && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Enter project objective..."
              value={objective}
              onChange={e => setObjective(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-xs flex-1"
              disabled={isLoading}
            />
            <Button
              size="sm"
              onClick={handleStart}
              disabled={isLoading || !objective.trim()}
              className="h-8 text-xs gap-1.5"
            >
              <Play className="h-3 w-3" />
              Start
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUpload}
              className="h-8 text-xs gap-1.5 text-zinc-400"
            >
              <Upload className="h-3 w-3" />
              .md
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          {pendingMdFiles.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {pendingMdFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300">
                  {f.name}
                  <button onClick={() => removePendingFile(i)} className="text-zinc-500 hover:text-zinc-300">&times;</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(isRunning || isPaused) && (
        <div className="flex items-center gap-2">
          {isRunning && (
            <>
              <Button variant="outline" size="sm" onClick={onPause} disabled={isLoading} className="h-8 text-xs gap-1.5">
                <Pause className="h-3 w-3" />
                Pause
              </Button>
              <Button variant="ghost" size="sm" onClick={onStop} disabled={isLoading} className="h-8 text-xs gap-1.5 text-red-400 hover:text-red-300">
                <Square className="h-3 w-3" />
                Stop
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button size="sm" onClick={onResume} disabled={isLoading} className="h-8 text-xs gap-1.5">
                <Play className="h-3 w-3" />
                Resume
              </Button>
              <Button variant="ghost" size="sm" onClick={onStop} disabled={isLoading} className="h-8 text-xs gap-1.5 text-red-400 hover:text-red-300">
                <Square className="h-3 w-3" />
                Stop
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={handleUpload} className="h-8 text-xs gap-1.5 text-zinc-400">
            <Upload className="h-3 w-3" />
            .md
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
}
