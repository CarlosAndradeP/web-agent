export type ApprovalMode = 'all' | 'none' | 'custom';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Session {
  id: string;
  name: string;
  model: string;
  projectId?: string;
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
  apiKeyConfigured?: boolean;
}

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
  costPerStep?: number;
  displayName?: string;
}

export interface AdminModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  enabled: boolean;
  costPerStep: number;
  displayName: string | null;
  configured: boolean;
  offline?: boolean;
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
  nodeReady?: boolean;
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

export interface NodeProcessInfo {
  uuid: string;
  name: string;
  projectId: string;
  port: number;
  pid: number | undefined;
  status: 'running' | 'stopped' | 'error';
  username?: string;
}

export type OrchestratorSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type OrchestratorRole = 'orchestrator' | 'auxiliar' | 'arquiteto' | 'programador' | 'revisor';

export interface OrchestratorSessionInfo {
  id: string;
  sessionId?: string;
  status: OrchestratorSessionStatus;
  objective: string;
  currentStep: string | null;
  progressPercent: number;
  errorCount: number;
  autoRecover: boolean;
  mdFiles: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorStepInfo {
  id: string;
  orchestratorSessionId: string;
  stepNumber: number;
  role: OrchestratorRole;
  model: string;
  action: string;
  input: string;
  output: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrchestratorStatusInfo {
  isRunning: boolean;
  lastHeartbeat: string;
  currentSessionId: string | null;
  totalStepsCompleted: number;
  session?: OrchestratorSessionInfo;
}
