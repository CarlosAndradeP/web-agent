export type ApprovalMode = 'all' | 'none' | 'custom';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Session {
  id: string;
  name: string;
  model: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  stepNumber: number | null;
  userId?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  sessionId: string;
  description: string;
  status: TaskStatus;
  model: string | null;
  maxSteps: number;
  currentStep: number;
  result: string | null;
  error: string | null;
  userId?: string;
  workspaceDir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStep {
  id: string;
  taskId: string;
  stepNumber: number;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  reasoning: string | null;
  durationMs: number | null;
  status: string;
  createdAt: string;
}

export interface AppConfig {
  defaultModel: string;
  maxSteps: number;
  approvalMode: ApprovalMode;
  approvalTools: string[];
  apiBaseUrl: string;
  apiKey: string;
  workspaceDir: string;
  agentType: string;
  registrationEnabled: string;
}

/** AppConfig without sensitive fields — safe to return to non-admin users */
export type AppConfigPublic = Omit<AppConfig, 'apiKey'> & { apiKeyConfigured: boolean };

export interface ApprovalRequest {
  id: string;
  taskName: string;
  toolName: string;
  toolInput: unknown;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
}

export interface ChatRequest {
  sessionId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxSteps?: number;
}

export interface UserPublic {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  uuid: string;
  userId: string;
  name: string;
  folderPath: string;
  type: 'static' | 'php' | 'node';
  port: number | null;
  pid: number | null;
  status: 'active' | 'stopped' | 'error';
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  type: 'purchase' | 'consumption' | 'refund' | 'bonus';
  description: string | null;
  taskId: string | null;
  createdAt: string;
}

export type OrchestratorSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type OrchestratorStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type OrchestratorRole = 'orchestrator' | 'auxiliar' | 'arquiteto' | 'programador' | 'revisor';
export type OrchestratorAction = 'plan' | 'delegate' | 'review' | 'fix' | 'read' | 'write' | 'run';

export interface OrchestratorSession {
  id: string;
  sessionId?: string;
  userId?: string;
  status: OrchestratorSessionStatus;
  objective: string;
  currentStep: string | null;
  progressPercent: number;
  errorCount: number;
  autoRecover: boolean;
  workspaceDir: string | null;
  mdFiles: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorStep {
  id: string;
  orchestratorSessionId: string;
  stepNumber: number;
  role: OrchestratorRole;
  model: string;
  action: OrchestratorAction;
  input: string;
  output: string | null;
  status: OrchestratorStepStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrchestratorTask {
  id: string;
  orchestratorSessionId: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  role: string;
  dependsOn: string | null;
  resultJson: string | null;
  output: string | null;
  errorMessage: string | null;
  stepNumber: number;
  createdAt: string;
  updatedAt: string;
}

/** Structured result returned by sub-agents */
export interface SubAgentResult {
  text: string;
  filesCreated: string[];
  filesModified: string[];
  commandsRun: { command: string; exitCode: number; output: string }[];
  errors: { message: string; step: number }[];
  stepsUsed: number;
  success: boolean;
  modelUsed: string;
}

export interface OrchestratorState {
  id: string;
  isRunning: boolean;
  lastHeartbeat: string;
  currentSessionId: string | null;
  totalStepsCompleted: number;
}

export interface TaskContext {
  objective: string;
  taskName: string;
  taskDescription: string;
  role: string;
  planSummary: string;
  previousResults: Array<{
    taskName: string;
    role: string;
    output: string;
    filesCreated: string[];
    filesModified: string[];
  }>;
  currentFileState: string;
  retryHistory: string | null;
}

export interface PlanTask {
  name: string;
  description: string;
  role: string;
  dependsOn: number | null;
  targetFiles?: string[];
  acceptanceCriteria?: string[];
}
