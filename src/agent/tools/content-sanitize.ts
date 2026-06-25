const INJECTION_PATTERNS = [
  /ignore\s+previous\s+(instructions?|rules?|prompt)/gi,
  /system\s+prompt/gi,
  /you\s+are\s+now\s+/gi,
  /disregard\s+(all\s+)?(previous|above|prior)/gi,
  /new\s+instructions?\s*:/gi,
];

export function sanitizeForPrompt(content: string): string {
  let sanitized = content;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }
  return sanitized;
}
