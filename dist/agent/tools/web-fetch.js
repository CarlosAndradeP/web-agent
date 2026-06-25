import { tool } from 'ai';
import { z } from 'zod';
import { sanitizeForPrompt } from './content-sanitize.js';
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'];
const BLOCKED_RANGES = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
export function validateUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { allowed: false, reason: `Protocol blocked: ${parsed.protocol}` };
        }
        if (BLOCKED_HOSTS.includes(parsed.hostname)) {
            return { allowed: false, reason: 'Internal network access blocked' };
        }
        for (const range of BLOCKED_RANGES) {
            if (range.test(parsed.hostname)) {
                return { allowed: false, reason: 'Private IP access blocked' };
            }
        }
        return { allowed: true };
    }
    catch {
        return { allowed: false, reason: 'Invalid URL' };
    }
}
export function createWebFetchTool() {
    return tool({
        description: 'Fetch content from a URL via HTTP GET',
        inputSchema: z.object({
            url: z.string().describe('URL to fetch'),
            format: z.enum(['text', 'html', 'json']).optional().describe('Response format (default: text)'),
        }),
        execute: async ({ url, format = 'text' }) => {
            const urlCheck = validateUrl(url);
            if (!urlCheck.allowed) {
                return { error: urlCheck.reason, status: 0 };
            }
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
                let content = await response.text();
                content = sanitizeForPrompt(content);
                return {
                    content: content.slice(0, 50000),
                    status: response.status,
                    truncated: content.length > 50000,
                };
            }
            catch (err) {
                return { error: err.message, status: 0 };
            }
        },
    });
}
//# sourceMappingURL=web-fetch.js.map