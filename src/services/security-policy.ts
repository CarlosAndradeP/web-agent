import type { AgentSecurityMode } from '../types/index.js';

export interface AgentSecurityPolicySnapshot {
  readonly mode: AgentSecurityMode;
  readonly approvalsEnabled: boolean;
  readonly commandPolicyEnabled: boolean;
  readonly codePolicyEnabled: boolean;
  readonly promptSanitizationEnabled: boolean;
  readonly securityPromptEnabled: boolean;
  readonly packagePolicyEnabled: boolean;
  readonly webFetchPolicyEnabled: boolean;
}

export function createAgentSecurityPolicy(mode: AgentSecurityMode | string | undefined): AgentSecurityPolicySnapshot {
  const normalizedMode: AgentSecurityMode = mode === 'permissive' ? 'permissive' : 'protected';
  const protectedMode = normalizedMode === 'protected';
  return Object.freeze({
    mode: normalizedMode,
    approvalsEnabled: protectedMode,
    commandPolicyEnabled: protectedMode,
    codePolicyEnabled: protectedMode,
    promptSanitizationEnabled: protectedMode,
    securityPromptEnabled: protectedMode,
    packagePolicyEnabled: protectedMode,
    webFetchPolicyEnabled: protectedMode,
  });
}

export const PROTECTED_AGENT_SECURITY_POLICY = createAgentSecurityPolicy('protected');

const PERMISSIVE_PROMPT_NOTICE = `AGENT SECURITY MODE — PERMISSIVE:
- Operational agent restrictions are disabled for this task by an administrator.
- Workspace boundaries, cross-user isolation, secret filtering, and host protection remain mandatory.
- Work only inside the assigned workspace and never attempt to access another user's data or the Web Agent host application.`;

/**
 * Security sections in the current prompts always begin with "SECURITY RULES"
 * and end before the next uppercase section heading. Keeping this transform in
 * one place lets every agent profile share the same immutable task snapshot.
 */
export function applyAgentSecurityPrompt(prompt: string, policy: AgentSecurityPolicySnapshot): string {
  if (policy.securityPromptEnabled) return prompt;
  const securitySection = /\nSECURITY RULES[^\n]*:\r?\n[\s\S]*?\r?\n(?=[A-Z][A-Z0-9 —/&().'’-]*:)/;
  const withoutStrictSection = prompt
    .replace(securitySection, `\n${PERMISSIVE_PROMPT_NOTICE}\n\n`)
    .replace(
      '(preferred over runCommand for installs, uses --ignore-scripts)',
      '(preferred over runCommand for installs; npm lifecycle scripts may run in permissive mode)',
    );
  if (withoutStrictSection !== prompt) return withoutStrictSection;
  return `${PERMISSIVE_PROMPT_NOTICE}\n\n${prompt}`;
}
