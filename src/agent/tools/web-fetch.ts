import { tool } from 'ai';
import { z } from 'zod';
import { sanitizeForPrompt } from './content-sanitize.js';
import { resolve4, resolve6 } from 'node:dns/promises';
import { logToolExecution } from '../../services/logger.js';

const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'host.docker.internal', '[::1]',
];

// Link-local, loopback, cloud metadata, and private IP ranges
const BLOCKED_IP_PREFIXES = [
  '10.',                     // RFC 1918: 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',  // RFC 1918: 172.16.0.0/12
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',               // RFC 1918: 192.168.0.0/16
  '169.254.',               // Link-local (includes cloud metadata 169.254.169.254)
  '127.',                    // Loopback range
  '0.',                      // 0.0.0.0/8
  '100.64.', '100.65.', '100.66.', '100.67.',  // Carrier-grade NAT 100.64.0.0/10
  '100.68.', '100.69.', '100.70.', '100.71.',
];

function isBlockedIP(ip: string): boolean {
  // Check against prefix list
  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (ip.startsWith(prefix)) return true;
  }

  // Check octal IPs (0177.0.0.1 = 127.0.0.1)
  if (/^0[0-7]/.test(ip)) return true;

  // Check hex IPs (0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(ip)) return true;

  // Check decimal IPs (2130706433 = 127.0.0.1)
  if (/^\d{8,10}$/.test(ip)) return true;

  // IPv6 loopback and mapped
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:ffff:7f00:1') return true;
  if (/^::ffff:/i.test(ip)) return true;
  if (/^0000:0000:0000:0000:0000:ffff:/i.test(ip)) return true;

  return false;
}

async function resolveAndCheckIP(hostname: string): Promise<boolean> {
  try {
    const addresses = await resolve4(hostname);
    for (const addr of addresses) {
      if (isBlockedIP(addr)) return true;
    }
  } catch {
    // DNS resolution may fail — try IPv6
  }
  try {
    const addresses = await resolve6(hostname);
    for (const addr of addresses) {
      if (isBlockedIP(addr)) return true;
    }
  } catch {
    // Both failed — if hostname is not an IP, allow (could be external)
  }
  return false;
}

export async function validateUrl(url: string): Promise<{ allowed: boolean; reason?: string }> {
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
    if (isBlockedIP(hostname)) {
      return { allowed: false, reason: 'Private/internal IP access blocked' };
    }

    // DNS resolution check — block resolved IPs that are private
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
    if (!isIP) {
      const blocked = await resolveAndCheckIP(hostname);
      if (blocked) {
        return { allowed: false, reason: 'Domain resolves to private/internal IP' };
      }
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
}

export function createWebFetchTool() {
  return tool({
    description: 'Fetch content from a URL via HTTP GET',
    inputSchema: z.object({
      url: z.string().describe('URL to fetch'),
    }),
    execute: async ({ url }) => {
      const startTime = Date.now();
      logToolExecution('webFetch', undefined, 'start', { input: { url } });

      const urlCheck = await validateUrl(url);
      if (!urlCheck.allowed) {
        logToolExecution('webFetch', undefined, 'error', { error: urlCheck.reason, input: { url }, durationMs: Date.now() - startTime });
        return { error: urlCheck.reason, status: 0 };
      }

      try {
        // Defense in depth against DNS rebinding (TOCTOU): re-resolve the
        // hostname immediately before fetch and reject if the resolved IP is
        // private/internal. Combined with the earlier lookup this narrows the
        // TOCTOU window, though fetch() may still re-resolve internally.
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^\[(.+)\]$/, '$1');
        const isDirectIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
        if (!isDirectIP) {
          let resolvedBlocked = false;
          try {
            const addrs = (await import('node:dns/promises')).lookup(hostname, { all: true });
            const list = await addrs;
            for (const a of list) {
              if (isBlockedIP(a.address)) { resolvedBlocked = true; break; }
            }
          } catch {}
          if (resolvedBlocked) {
            return { error: 'Domain re-resolved to private/internal IP', status: 0 };
          }
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        let content = await response.text();
        content = sanitizeForPrompt(content);
        logToolExecution('webFetch', undefined, 'success', {
          output: { status: response.status, contentLength: content.length },
          durationMs: Date.now() - startTime,
        });
        return {
          content: content.slice(0, 50000),
          status: response.status,
          truncated: content.length > 50000,
        };
      } catch (err: any) {
        logToolExecution('webFetch', undefined, 'error', { error: err.message, input: { url }, durationMs: Date.now() - startTime });
        return { error: err.message, status: 0 };
      }
    },
  });
}
