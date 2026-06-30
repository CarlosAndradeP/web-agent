import { useOrchestrator } from '../hooks/useOrchestrator';
import OrchestratorHeader from './OrchestratorHeader';
import OrchestratorLog from './OrchestratorLog';
import OrchestratorControls from './OrchestratorControls';
import { useEffect } from 'react';

export default function AutonomousPanel() {
  const { status, steps, logs, isLoading, start, stop, pause, resume, uploadMd, refresh } = useOrchestrator();

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <OrchestratorHeader
        status={status}
        isLoading={isLoading}
      />
      <div className="flex-1 overflow-hidden flex flex-col">
        <OrchestratorLog steps={steps} logs={logs} />
      </div>
      <OrchestratorControls
        status={status}
        isLoading={isLoading}
        onStart={start}
        onStop={stop}
        onPause={pause}
        onResume={resume}
        onUploadMd={uploadMd}
      />
    </div>
  );
}
