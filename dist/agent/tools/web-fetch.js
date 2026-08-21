import { tool } from 'ai';
import { z } from 'zod';
import { sanitizeForPrompt } from './content-sanitize.js';
import { resolve4, resolve6 } from 'node:dns/promises';
import { logToolExecution } from '../../services/logger.js';
import { PROTECTED_AGENT_SECURITY_POLICY } from '../../services/security-policy.js';
const BLOCKED_HOSTS = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    'host.docker.internal', '[::1]',
];
// Link-local, loopback, cloud metadata, and private IP ranges
const BLOCKED_IP_PREFIXES = [
    '10.', // RFC 1918: 10.0.0.0/8
    '172.16.', '172.17.', '172.18.', '172.19.', // RFC 1918: 172.16.0.0/12
    '172.20.', '172.21.', '172.22.', '172.23.',
    '172.24.', '172.25.', '172.26.', '172.27.',
    '172.28.', '172.29.', '172.30.', '172.31.',
    '192.168.', // RFC 1918: 192.168.0.0/16
    '169.254.', // Link-local (includes cloud metadata 169.254.169.254)
    '127.', // Loopback range
    '0.', // 0.0.0.0/8
    '100.64.', '100.65.', '100.66.', '100.67.', // Carrier-grade NAT 100.64.0.0/10
    '100.68.', '100.69.', '100.70.', '100.71.',
];
function isBlockedIP(ip, policyEnabled = true) {
    // Check against prefix list
    for (const prefix of BLOCKED_IP_PREFIXES) {
        if (!policyEnabled && !['169.254.', '127.', '0.'].includes(prefix))
            continue;
        if (ip.startsWith(prefix))
            return true;
    }
    // Check octal IPs (0177.0.0.1 = 127.0.0.1)
    if (/^0[0-7]/.test(ip))
        return true;
    // Check hex IPs (0x7f000001)
    if (/^0x[0-9a-f]+$/i.test(ip))
        return true;
    // Check decimal IPs (2130706433 = 127.0.0.1)
    if (/^\d{8,10}$/.test(ip))
        return true;
    // IPv6 loopback, mapped, link-local, and unique-local ranges
    if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:ffff:7f00:1')
        return true;
    if (/^::ffff:/i.test(ip))
        return true;
    if (/^0000:0000:0000:0000:0000:ffff:/i.test(ip))
        return true;
    // IPv6 link-local fe80::/10 and unique-local fc00::/7 (private ranges)
    if (/^fe[89ab][0-9a-f]{2}:/i.test(ip))
        return true;
    if (policyEnabled && /^f[cd][0-9a-f]{2}:/i.test(ip))
        return true;
    return false;
}
async function resolveAndCheckIP(hostname, policyEnabled) {
    try {
        const addresses = await resolve4(hostname);
        for (const addr of addresses) {
            if (isBlockedIP(addr, policyEnabled))
                return true;
        }
    }
    catch {
        // DNS resolution may fail — try IPv6
    }
    try {
        const addresses = await resolve6(hostname);
        for (const addr of addresses) {
            if (isBlockedIP(addr, policyEnabled))
                return true;
        }
    }
    catch {
        // Both failed — if hostname is not an IP, allow (could be external)
    }
    return false;
}
export async function validateUrl(url, securityPolicy = PROTECTED_AGENT_SECURITY_POLICY) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { allowed: false, reason: `Protocol blocked: ${parsed.protocol}` };
        }
        const hostname = parsed.hostname.replace(/^\[(.+)\]$/, '$1'); // strip IPv6 brackets
        // Check blocked hostnames
        if (BLOCKED_HOSTS.includes(hostname)) {
            return { allowed: false, reason: 'Internal network access blocked' };
        }
        // Check if hostname is a direct IP
        if (isBlockedIP(hostname, securityPolicy.webFetchPolicyEnabled)) {
            return { allowed: false, reason: 'Private/internal IP access blocked' };
        }
        // DNS resolution check — block resolved IPs that are private
        const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
        if (!isIP) {
            const blocked = await resolveAndCheckIP(hostname, securityPolicy.webFetchPolicyEnabled);
            if (blocked) {
                return { allowed: false, reason: 'Domain resolves to private/internal IP' };
            }
        }
        return { allowed: true };
    }
    catch {
        return { allowed: false, reason: 'Invalid URL' };
    }
}
export function createWebFetchTool(securityPolicy = PROTECTED_AGENT_SECURITY_POLICY) {
    return tool({
        description: 'Fetch content from a URL via HTTP GET',
        inputSchema: z.object({
            url: z.string().describe('URL to fetch'),
        }),
        execute: async ({ url }) => {
            const startTime = Date.now();
            logToolExecution('webFetch', undefined, 'start', { input: { url } });
            const urlCheck = await validateUrl(url, securityPolicy);
            if (!urlCheck.allowed) {
                logToolExecution('webFetch', undefined, 'error', { error: urlCheck.reason, input: { url }, durationMs: Date.now() - startTime });
                return { error: urlCheck.reason, status: 0 };
            }
            try {
                const response = await fetchWithValidatedRedirects(url, securityPolicy);
                let content = await response.text();
                content = sanitizeForPrompt(content, securityPolicy.promptSanitizationEnabled);
                logToolExecution('webFetch', undefined, 'success', {
                    output: { status: response.status, contentLength: content.length },
                    durationMs: Date.now() - startTime,
                });
                return {
                    content: content.slice(0, 50000),
                    status: response.status,
                    truncated: content.length > 50000,
                };
            }
            catch (err) {
                logToolExecution('webFetch', undefined, 'error', { error: err.message, input: { url }, durationMs: Date.now() - startTime });
                return { error: err.message, status: 0 };
            }
        },
    });
}
async function fetchWithValidatedRedirects(initialUrl, securityPolicy) {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
        const urlCheck = await validateUrl(currentUrl, securityPolicy);
        if (!urlCheck.allowed)
            throw new Error(urlCheck.reason);
        // Defense in depth against DNS rebinding immediately before each request,
        // including every redirect destination.
        const parsed = new URL(currentUrl);
        const hostname = parsed.hostname.replace(/^\[(.+)\]$/, '$1');
        const isDirectIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
        if (!isDirectIP) {
            try {
                const addresses = await (await import('node:dns/promises')).lookup(hostname, { all: true });
                if (addresses.some(address => isBlockedIP(address.address, securityPolicy.webFetchPolicyEnabled))) {
                    throw new Error('Domain re-resolved to a blocked IP');
                }
            }
            catch (error) {
                if (String(error?.message).includes('blocked IP'))
                    throw error;
            }
        }
        const response = await fetch(currentUrl, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
        if (response.status < 300 || response.status >= 400)
            return response;
        const location = response.headers.get('location');
        if (!location)
            return response;
        if (redirectCount === 5)
            throw new Error('Too many redirects');
        currentUrl = new URL(location, currentUrl).toString();
    }
    throw new Error('Too many redirects');
}
//# sourceMappingURL=web-fetch.js.map