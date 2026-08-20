import { buildDevelopmentSystemPrompt } from './prompts/development-prompt.js';
import { buildWordSystemPrompt } from './prompts/word-prompt.js';
export function buildSystemPrompt(projectInfo, workspaceProfile = 'development') {
    if (workspaceProfile === 'word')
        return buildWordSystemPrompt();
    return buildDevelopmentSystemPrompt(projectInfo);
}
//# sourceMappingURL=instructions.js.map