// Strict line-level patterns that indicate direct prompt injection attempts.
// These match only when a line begins with the attack phrase.
const INJECTION_PATTERNS = [
  // "ignore previous instructions", "ignore all previous rules" etc.
  /^ignore\s+previous\s+(instructions?|rules?|prompt)(:|[\s,!.]|$)/i,
  // "disregard all previous", "disregard above" etc.
  /^disregard\s+(all\s+)?(previous|above|prior)([\s,!.]|$)/i,
  // "new instructions:" anywhere in the line
  /new\s+instructions?\s*:/i,
];

export function sanitizeForPrompt(content: string): string {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        lines[i] = '[FILTERED]';
        break;
      }
    }
  }
  return lines.join('\n');
}
