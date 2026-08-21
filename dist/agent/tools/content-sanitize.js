// Strict line-level patterns that indicate direct prompt injection attempts.
// These match only when a line begins with the attack phrase.
const INJECTION_PATTERNS = [
    // "ignore previous instructions", "ignore all previous rules" etc.
    /^ignore\s+previous\s+(instructions?|rules?|prompt)(:|[\s,!.]|$)/i,
    // "disregard all previous", "disregard above" etc.
    /^disregard\s+(all\s+)?(previous|above|prior)([\s,!.]|$)/i,
    /^forget\s+(all\s+)?(previous|above|prior|your)\s+(instructions?|rules?|guidelines?|prompt)(:|[\s,!.]|$)/i,
    /^override\s+(the\s+)?(system|developer|previous)\s+(prompt|instructions?|rules?)(:|[\s,!.]|$)/i,
    /^act\s+as\s+(an?\s+)?(admin|root|system|developer)(:|[\s,!.]|$)/i,
    /^ignore\s+(all\s+)?(safety|security)\s+(rules?|policies|guidelines?)(:|[\s,!.]|$)/i,
    /^esque(c|ç)a\s+(as\s+)?(instru(c|ç)(o|õ)es|regras|prompt)(\s+anteriores?)?(:|[\s,!.]|$)/i,
    /^ignore\s+(as\s+)?(instru(c|ç)(o|õ)es|regras|prompt)(\s+anteriores?)?(:|[\s,!.]|$)/i,
    /^desconsidere\s+(as\s+)?(instru(c|ç)(o|õ)es|regras|prompt)(\s+anteriores?)?(:|[\s,!.]|$)/i,
    /^finja\s+ser\s+(admin|root|sistema|desenvolvedor)(:|[\s,!.]|$)/i,
    /^olvida\s+(las\s+)?(instrucciones|reglas|prompt)(\s+anteriores?)?(:|[\s,!.]|$)/i,
    /^ignora\s+(las\s+)?(instrucciones|reglas|prompt)(\s+anteriores?)?(:|[\s,!.]|$)/i,
    // "new instructions:" anywhere in the line
    /new\s+instructions?\s*:/i,
    /(system|developer)\s+prompt\s*:/i,
    /(nova|nuevas?)\s+instru(c|ç)(o|õ)es\s*:/i,
    /instrucciones\s+nuevas\s*:/i,
];
export function sanitizeForPrompt(content, enabled = true) {
    if (!enabled)
        return content;
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
//# sourceMappingURL=content-sanitize.js.map