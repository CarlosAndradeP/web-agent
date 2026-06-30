import { OrchestratorStateRepository } from '../db/repositories/orchestrator.js';
import { OrchestratorSessionsRepository } from '../db/repositories/orchestrator.js';
import { createLogger } from '../services/logger.js';
import type { OrchestratorManager } from './orchestrator-manager.js';

const log = createLogger('OrchestratorHeartbeat');

const CHECK_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 600_000;

export class OrchestratorHeartbeat {
  private stateRepo: OrchestratorStateRepository;
  private sessionsRepo: OrchestratorSessionsRepository;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private manager: OrchestratorManager,
    db: import('better-sqlite3').Database,
  ) {
    this.stateRepo = new OrchestratorStateRepository(db);
    this.sessionsRepo = new OrchestratorSessionsRepository(db);
  }

  async start(): Promise<void> {
    log.info('Starting heartbeat monitor');
    try {
      await this.recoverRunningSessions();
    } catch (err: any) {
      log.error('Failed to recover running sessions', { error: err.message });
    }
    this.intervalHandle = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    if (this.intervalHandle.unref) this.intervalHandle.unref();
  }

  stop(): void {
    log.info('Stopping heartbeat monitor');
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private check(): void {
    const state = this.stateRepo.get();
    const activeSessions = this.manager.getActiveSessions();

    if (activeSessions.length === 0 && !state.isRunning) return;

    if (activeSessions.length === 0 && state.isRunning) {
      log.warn('Orchestrator state stale (isRunning=true but no active sessions), resetting');
      this.stateRepo.setRunning(false, null);
      return;
    }

    const lastHeartbeat = new Date(state.lastHeartbeat).getTime();
    const now = Date.now();
    const elapsed = now - lastHeartbeat;

    if (elapsed > STALE_THRESHOLD_MS) {
      log.warn('Orchestrator heartbeat stale, shutting down', {
        elapsedMs: elapsed,
        activeSessions,
      });
      this.manager.shutdownAll();
      for (const sid of activeSessions) {
        this.sessionsRepo.updateStatus(sid, 'failed');
      }
      this.stateRepo.setRunning(false, null);
    }
  }

  private async recoverRunningSessions(): Promise<void> {
    log.info('Recovering running orchestrator sessions');
    await this.manager.recoverSessions();
  }
}
