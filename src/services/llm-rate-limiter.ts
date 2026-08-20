import { createLogger } from './logger.js';

const log = createLogger('LlmRateLimiter');
const MIN_REQUESTS_PER_MINUTE = 1;
const MAX_REQUESTS_PER_MINUTE = 10_000;
const ONE_MINUTE_MS = 60_000;

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface LlmRateLimitStatus {
  enabled: boolean;
  requestsPerMinute: number;
  queuedRequests: number;
  requestsLastMinute: number;
  nextRequestInMs: number;
}

/**
 * Process-wide FIFO limiter for outbound LLM requests. Requests are smoothed
 * across the minute instead of being released in a burst at each window edge.
 */
export class LlmRateLimiter {
  private enabled = false;
  private requestsPerMinute = 60;
  private queue: QueueEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastDispatchAt = 0;
  private dispatchHistory: number[] = [];

  configure(enabled: boolean, requestsPerMinute: number): LlmRateLimitStatus {
    const finiteLimit = Number.isFinite(requestsPerMinute) ? requestsPerMinute : 60;
    const normalizedLimit = Math.min(
      MAX_REQUESTS_PER_MINUTE,
      Math.max(MIN_REQUESTS_PER_MINUTE, Math.trunc(finiteLimit)),
    );
    const changed = this.enabled !== enabled || this.requestsPerMinute !== normalizedLimit;
    this.enabled = enabled;
    this.requestsPerMinute = normalizedLimit;

    if (changed) {
      log.info('Configuration updated', {
        enabled,
        requestsPerMinute: normalizedLimit,
        queuedRequests: this.queue.length,
      });
    }

    this.clearTimer();
    this.processQueue();
    return this.getStatus();
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(this.abortError());

    if (!this.enabled) {
      this.recordDispatch();
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          reject(this.abortError());
          this.processQueue();
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      this.processQueue();
    });
  }

  getStatus(): LlmRateLimitStatus {
    this.pruneHistory();
    const nextRequestInMs = this.enabled && this.queue.length > 0
      ? Math.max(0, this.nextDispatchAt() - Date.now())
      : 0;
    return {
      enabled: this.enabled,
      requestsPerMinute: this.requestsPerMinute,
      queuedRequests: this.queue.length,
      requestsLastMinute: this.dispatchHistory.length,
      nextRequestInMs,
    };
  }

  private processQueue(): void {
    this.clearTimer();
    if (this.queue.length === 0) return;

    if (!this.enabled) {
      const pending = this.queue.splice(0);
      for (const entry of pending) this.release(entry);
      return;
    }

    const delayMs = Math.max(0, this.nextDispatchAt() - Date.now());
    if (delayMs > 0) {
      this.timer = setTimeout(() => this.processQueue(), delayMs);
      return;
    }

    const entry = this.queue.shift();
    if (!entry) return;
    this.release(entry);
    this.processQueue();
  }

  private release(entry: QueueEntry): void {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    if (entry.signal?.aborted) {
      entry.reject(this.abortError());
      return;
    }
    this.recordDispatch();
    entry.resolve();
  }

  private recordDispatch(): void {
    const now = Date.now();
    this.lastDispatchAt = now;
    this.dispatchHistory.push(now);
    this.pruneHistory(now);
  }

  private nextDispatchAt(): number {
    if (this.lastDispatchAt === 0) return 0;
    return this.lastDispatchAt + Math.ceil(ONE_MINUTE_MS / this.requestsPerMinute);
  }

  private pruneHistory(now = Date.now()): void {
    const cutoff = now - ONE_MINUTE_MS;
    while (this.dispatchHistory.length > 0 && this.dispatchHistory[0] <= cutoff) {
      this.dispatchHistory.shift();
    }
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private abortError(): Error {
    return new DOMException('The LLM request was aborted while waiting in the rate-limit queue', 'AbortError');
  }
}

export const llmRateLimiter = new LlmRateLimiter();

export const LLM_RATE_LIMIT_BOUNDS = {
  minRequestsPerMinute: MIN_REQUESTS_PER_MINUTE,
  maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
};
