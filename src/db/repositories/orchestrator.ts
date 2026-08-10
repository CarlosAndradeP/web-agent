import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { OrchestratorSession, OrchestratorStep, OrchestratorState, OrchestratorSessionStatus, OrchestratorStepStatus, OrchestratorRole, OrchestratorAction, OrchestratorTask } from '../../types/index.js';

export class OrchestratorSessionsRepository {
  constructor(private db: Database.Database) {}

  create(sessionId: string | null, userId: string | undefined, objective: string, workspaceDir: string | null): OrchestratorSession {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO orchestrator_sessions (id, session_id, user_id, status, objective, current_step, progress_percent, error_count, auto_recover, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 1, ?, ?, ?)'
    ).run(id, sessionId ?? null, userId ?? null, 'idle', objective, workspaceDir, now, now);
    return {
      id, sessionId: sessionId ?? undefined, userId, status: 'idle', objective, currentStep: null, progressPercent: 0,
      errorCount: 0, autoRecover: true, workspaceDir, mdFiles: null, createdAt: now, updatedAt: now,
    };
  }

  findById(id: string): OrchestratorSession | undefined {
    const row = this.db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  findBySessionId(sessionId: string): OrchestratorSession | undefined {
    const row = this.db.prepare('SELECT * FROM orchestrator_sessions WHERE session_id = ?').get(sessionId) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  findActive(): OrchestratorSession[] {
    const rows = this.db.prepare("SELECT * FROM orchestrator_sessions WHERE status = 'running'").all() as any[];
    return rows.map(this.mapRow);
  }

  listByUserId(userId: string): OrchestratorSession[] {
    const rows = this.db.prepare('SELECT * FROM orchestrator_sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[];
    return rows.map(this.mapRow);
  }

  listRunning(): OrchestratorSession[] {
    const rows = this.db.prepare("SELECT * FROM orchestrator_sessions WHERE status = 'running'").all() as any[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, status: OrchestratorSessionStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE orchestrator_sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  updateProgress(id: string, percent: number, currentStep: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE orchestrator_sessions SET progress_percent = ?, current_step = ?, updated_at = ? WHERE id = ?').run(percent, currentStep, now, id);
  }

  incrementErrorCount(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE orchestrator_sessions SET error_count = error_count + 1, updated_at = ? WHERE id = ?').run(now, id);
  }

  updateMdFiles(id: string, mdFilesJson: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE orchestrator_sessions SET md_files = ?, updated_at = ? WHERE id = ?').run(mdFilesJson, now, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM orchestrator_sessions WHERE id = ?').run(id);
  }

  private mapRow(row: any): OrchestratorSession {
    return {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id ?? undefined,
      status: row.status,
      objective: row.objective,
      currentStep: row.current_step,
      progressPercent: row.progress_percent,
      errorCount: row.error_count,
      autoRecover: row.auto_recover === 1,
      workspaceDir: row.workspace_dir,
      mdFiles: row.md_files,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class OrchestratorStepsRepository {
  constructor(private db: Database.Database) {}

  create(orchestratorSessionId: string, stepNumber: number, role: OrchestratorRole, model: string, action: OrchestratorAction, input: string): OrchestratorStep {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO orchestrator_steps (id, orchestrator_session_id, step_number, role, model, action, input, output, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)'
    ).run(id, orchestratorSessionId, stepNumber, role, model, action, input, 'pending', now);
    return {
      id, orchestratorSessionId, stepNumber, role, model, action, input,
      output: null, status: 'pending', errorMessage: null, durationMs: null, createdAt: now, completedAt: null,
    };
  }

  findBySession(orchestratorSessionId: string): OrchestratorStep[] {
    const rows = this.db.prepare('SELECT * FROM orchestrator_steps WHERE orchestrator_session_id = ? ORDER BY step_number ASC').all(orchestratorSessionId) as any[];
    return rows.map(this.mapRow);
  }

  findById(id: string): OrchestratorStep | undefined {
    const row = this.db.prepare('SELECT * FROM orchestrator_steps WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  updateResult(id: string, output: string | null, status: OrchestratorStepStatus, errorMessage?: string | null, durationMs?: number | null): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE orchestrator_steps SET output = ?, status = ?, error_message = ?, duration_ms = ?, completed_at = ? WHERE id = ?'
    ).run(output, status, errorMessage ?? null, durationMs ?? null, status === 'completed' || status === 'failed' ? now : null, id);
  }

  countBySession(orchestratorSessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM orchestrator_steps WHERE orchestrator_session_id = ?').get(orchestratorSessionId) as any;
    return row.count;
  }

  private mapRow(row: any): OrchestratorStep {
    return {
      id: row.id,
      orchestratorSessionId: row.orchestrator_session_id,
      stepNumber: row.step_number,
      role: row.role,
      model: row.model,
      action: row.action,
      input: row.input,
      output: row.output,
      status: row.status,
      errorMessage: row.error_message,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}

export class OrchestratorStateRepository {
  constructor(private db: Database.Database) {}

  get(): OrchestratorState {
    const row = this.db.prepare("SELECT * FROM orchestrator_state WHERE id = 'singleton'").get() as any;
    if (!row) {
      this.db.prepare("INSERT OR IGNORE INTO orchestrator_state (id, is_running, last_heartbeat, current_session_id, total_steps_completed) VALUES ('singleton', 0, datetime('now'), NULL, 0)").run();
      return { id: 'singleton', isRunning: false, lastHeartbeat: new Date().toISOString(), currentSessionId: null, totalStepsCompleted: 0 };
    }
    return this.mapRow(row);
  }

  setRunning(isRunning: boolean, sessionId?: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE orchestrator_state SET is_running = ?, current_session_id = ?, last_heartbeat = ? WHERE id = 'singleton'"
    ).run(isRunning ? 1 : 0, sessionId ?? null, now);
  }

  updateHeartbeat(): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE orchestrator_state SET last_heartbeat = ? WHERE id = 'singleton'").run(now);
  }

  incrementSteps(count: number = 1): void {
    this.db.prepare("UPDATE orchestrator_state SET total_steps_completed = total_steps_completed + ? WHERE id = 'singleton'").run(count);
  }

  private mapRow(row: any): OrchestratorState {
    return {
      id: row.id,
      isRunning: row.is_running === 1,
      lastHeartbeat: row.last_heartbeat,
      currentSessionId: row.current_session_id,
      totalStepsCompleted: row.total_steps_completed,
    };
  }
}

// --- OrchestratorTasksRepository ---
// Tracks individual tasks within an orchestrator session

export interface OrchestratorTaskInput {
  name: string;
  description: string;
  role: string;
  dependsOn?: string | null;
  stepNumber: number;
}

export class OrchestratorTasksRepository {
  constructor(private db: Database.Database) {}

  create(sessionId: string, input: OrchestratorTaskInput): OrchestratorTask {
    const id = uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO orchestrator_tasks (id, orchestrator_session_id, name, description, status, role, depends_on, result_json, output, error_message, step_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, sessionId, input.name, input.description, 'pending', input.role, input.dependsOn ?? null, null, null, null, input.stepNumber, now, now);
    return {
      id,
      orchestratorSessionId: sessionId,
      name: input.name,
      description: input.description,
      status: 'pending',
      role: input.role,
      dependsOn: input.dependsOn ?? null,
      resultJson: null,
      output: null,
      errorMessage: null,
      stepNumber: input.stepNumber,
      createdAt: now,
      updatedAt: now,
    };
  }

  findBySession(sessionId: string): OrchestratorTask[] {
    const rows = this.db
      .prepare('SELECT * FROM orchestrator_tasks WHERE orchestrator_session_id = ? ORDER BY step_number ASC, created_at ASC')
      .all(sessionId) as any[];
    return rows.map(this.mapRow);
  }

  findById(id: string): OrchestratorTask | undefined {
    const row = this.db.prepare('SELECT * FROM orchestrator_tasks WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  findPending(sessionId: string): OrchestratorTask[] {
    const rows = this.db
      .prepare("SELECT * FROM orchestrator_tasks WHERE orchestrator_session_id = ? AND status = 'pending' ORDER BY step_number ASC")
      .all(sessionId) as any[];
    return rows.map(this.mapRow);
  }

  findCompleted(sessionId: string): OrchestratorTask[] {
    const rows = this.db
      .prepare("SELECT * FROM orchestrator_tasks WHERE orchestrator_session_id = ? AND status = 'completed' ORDER BY step_number ASC")
      .all(sessionId) as any[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, status: 'pending' | 'running' | 'completed' | 'failed'): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE orchestrator_tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  updateResult(id: string, output: string | null, status: 'pending' | 'running' | 'completed' | 'failed', errorMessage?: string | null, resultJson?: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE orchestrator_tasks SET output = ?, status = ?, error_message = ?, result_json = ?, updated_at = ? WHERE id = ?')
      .run(output, status, errorMessage ?? null, resultJson ?? null, now, id);
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM orchestrator_tasks WHERE orchestrator_session_id = ?').run(sessionId);
  }

  private mapRow(row: any): OrchestratorTask {
    return {
      id: row.id,
      orchestratorSessionId: row.orchestrator_session_id,
      name: row.name,
      description: row.description,
      status: row.status,
      role: row.role,
      dependsOn: row.depends_on ?? null,
      resultJson: row.result_json,
      output: row.output,
      errorMessage: row.error_message,
      stepNumber: row.step_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
