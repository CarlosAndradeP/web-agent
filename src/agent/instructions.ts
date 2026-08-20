import type { ProjectInfo } from './index.js';
import { buildDevelopmentSystemPrompt } from './prompts/development-prompt.js';
import { buildWordSystemPrompt } from './prompts/word-prompt.js';

export type WorkspaceProfile = 'development' | 'word';

export function buildSystemPrompt(projectInfo: ProjectInfo | null, workspaceProfile: WorkspaceProfile = 'development'): string {
  if (workspaceProfile === 'word') return buildWordSystemPrompt();
  return buildDevelopmentSystemPrompt(projectInfo);
}
