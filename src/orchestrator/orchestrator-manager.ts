import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import { OrchestratorRunner } from './orchestrator-runner.js';
import { CreditManager } from '../services/credit-manager.js';
import { createLogger } from '../services/logger.js';
import type { ProjectRouter } from '../services/project-router.js';
import type { ProjectsRepository } from '../db/repositories/projects.js';
import type { UsersRepository } from '../db/repositories/users.js';

const log = createLogger('OrchestratorManager');

/**
 * Manages multiple OrchestratorRunner instances, one per session.
 * This enables multiple users to run autonomous projects simultaneously.
 */
export class OrchestratorManager {
  private runners = new Map<string, OrchestratorRunner>();
  private io: Server | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database.Database,
    private creditManager: CreditManager,
    private projectRouter: ProjectRouter,
    private projectsRepo: ProjectsRepository,
    private usersRepo: UsersRepository,
  ) {
    this.cleanupTimer = setInterval(() => this.pruneInactive(), 60000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  setIo(io: Server): void {
    this.io = io;
    for (const runner of this.runners.values()) {
      runner.setIo(io);
    }
  }

  /**
   * Start an orchestrator session. Creates a new runner if not already running.
   */
  async start(sessionId: string): Promise<void> {
    this.pruneInactive();
    if (this.runners.has(sessionId)) {
      log.warn('Session already has an active runner', { sessionId });
      return;
    }

    const runner = this.createRunner();
    if (this.io) runner.setIo(this.io);
    this.runners.set(sessionId, runner);

    try {
      await runner.start(sessionId);
    } catch (err: any) {
      log.error('Failed to start runner', { sessionId, error: err.message });
      this.runners.delete(sessionId);
      throw err;
    }
  }

  /**
   * Resume a paused orchestrator session.
   */
  async resume(sessionId: string): Promise<void> {
    const existing = this.runners.get(sessionId);
    if (existing) {
      await existing.resume(sessionId);
      return;
    }

    const runner = this.createRunner();
    if (this.io) runner.setIo(this.io);
    this.runners.set(sessionId, runner);
    await runner.resume(sessionId);
  }

  /**
   * Pause an orchestrator session.
   */
  pause(sessionId: string): void {
    const runner = this.runners.get(sessionId);
    if (runner) {
      runner.pause(sessionId);
    }
  }

  /**
   * Stop an orchestrator session.
   */
  stop(sessionId: string): void {
    const runner = this.runners.get(sessionId);
    if (runner) {
      runner.stop(sessionId);
      this.runners.delete(sessionId);
    }
  }

  /**
   * Get status information for a specific session.
   */
  getStatus(sessionId: string): { running: boolean; sessionId: string | null } {
    const runner = this.runners.get(sessionId);
    return {
      running: runner?.isRunning() ?? false,
      sessionId: runner?.getCurrentSessionId() ?? null,
    };
  }

  /**
   * Check if any runner is currently active for a session.
   */
  isRunning(sessionId: string): boolean {
    return this.runners.has(sessionId) && (this.runners.get(sessionId)?.isRunning() ?? false);
  }

  /**
   * Get list of all active session IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.runners.entries())
      .filter(([, runner]) => runner.isRunning())
      .map(([id]) => id);
  }

  /**
   * Remove completed or failed runners to prevent memory leaks.
   */
  pruneInactive(): void {
    let removed = 0;
    for (const [id, runner] of this.runners) {
      if (!runner.isRunning()) {
        this.runners.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      log.info('Pruned inactive orchestrator runners', { removed, remaining: this.runners.size });
    }
  }

  /**
   * Recover sessions that were running before a server restart.
   * Call this on startup.
   */
  async recoverSessions(): Promise<void> {
    const { OrchestratorSessionsRepository } = await import('../db/repositories/orchestrator.js');
    const sessionsRepo = new OrchestratorSessionsRepository(this.db);
    const running = sessionsRepo.listRunning();

    log.info('Recovering orchestrator sessions', { count: running.length });

    for (const session of running) {
      try {
        log.info('Recovering session', { sessionId: session.id });
        const runner = this.createRunner();
        if (this.io) runner.setIo(this.io);
        this.runners.set(session.id, runner);
        await runner.resume(session.id);
      } catch (err: any) {
        log.error('Failed to recover session', { sessionId: session.id, error: err.message });
      }
    }
  }

  /**
   * Graceful shutdown of all runners.
   */
  shutdownAll(): void {
    log.info('Shutting down all orchestrator runners', { count: this.runners.size });
    for (const [sessionId, runner] of this.runners) {
      try {
        runner.shutdown();
      } catch (err: any) {
        log.error('Error shutting down runner', { sessionId, error: err.message });
      }
    }
    this.runners.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private createRunner(): OrchestratorRunner {
    return new OrchestratorRunner(
      this.db,
      this.creditManager,
      this.projectRouter,
      this.projectsRepo,
      this.usersRepo,
    );
  }
}
