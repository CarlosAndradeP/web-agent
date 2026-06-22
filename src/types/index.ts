export type ApprovalMode = 'all' | 'none' | 'custom';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Session {
  id: string;
  name: string;
  model: string;
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
}

export interface ChatRequest {
  sessionId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxSteps?: number;
}
