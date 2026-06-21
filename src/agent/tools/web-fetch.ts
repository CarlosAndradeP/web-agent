import { tool } from 'ai';
import { z } from 'zod';

export function createWebFetchTool() {
  return tool({
    description: 'Fetch content from a URL via HTTP GET',
    inputSchema: z.object({
      url: z.string().describe('URL to fetch'),
      format: z.enum(['text', 'html', 'json']).optional().describe('Response format (default: text)'),
    }),
    execute: async ({ url, format = 'text' }) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const content = await response.text();
        return {
          content: content.slice(0, 50000),
          status: response.status,
          truncated: content.length > 50000,
        };
      } catch (err: any) {
        return { error: err.message, status: 0 };
      }
    },
  });
}
