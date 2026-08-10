import { mkdirSync, existsSync, createWriteStream, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const streamCache = new Map<string, WriteStream>();

function getLogStream(logDir: string, dateStr: string): WriteStream | null {
  const key = `${logDir}:${dateStr}`;
  let stream = streamCache.get(key);
  if (stream && !stream.destroyed) return stream;

  try {
    const logFile = resolve(logDir, `${dateStr}.log`);
    stream = createWriteStream(logFile, { flags: 'a' });
    stream.on('error', () => {
      streamCache.delete(key);
    });
    streamCache.set(key, stream);
    return stream;
  } catch {
    return null;
  }
}

process.on('exit', () => {
  for (const stream of streamCache.values()) {
    if (!stream.destroyed) stream.end();
  }
});

// Prune stale write streams to avoid unbounded growth of the streamCache map.
// Streams for dates older than `maxAgeDays` are closed and evicted.
const STREAM_CACHE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function pruneStaleStreams(): void {
  const now = Date.now();
  for (const [key, stream] of streamCache) {
    const dateStr = key.split(':').slice(-1)[0];
    const streamTime = Date.parse(`${dateStr}T00:00:00Z`);
    if (Number.isFinite(streamTime) && (now - streamTime) > STREAM_CACHE_MAX_AGE_MS) {
      if (!stream.destroyed) stream.end();
      streamCache.delete(key);
    } else if (stream.destroyed) {
      streamCache.delete(key);
    }
  }
}

// Run prune periodically (every hour) to evict streams for past days.
setInterval(pruneStaleStreams, 60 * 60 * 1000).unref();
pruneStaleStreams();

export class Logger {
  private context: string;
  private logDir: string;
  private minLevel: LogLevel;
  private enableFile: boolean;
  private correlationId?: string;

  constructor(context: string, options?: { logDir?: string; minLevel?: LogLevel; enableFile?: boolean; correlationId?: string }) {
    this.context = context;
    this.logDir = options?.logDir ?? resolve(process.cwd(), 'data', 'logs');
    this.minLevel = options?.minLevel ?? (process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL.toUpperCase() as keyof typeof LogLevel] as LogLevel : LogLevel.DEBUG);
    this.enableFile = options?.enableFile ?? (process.env.LOG_FILE !== 'false');
    this.correlationId = options?.correlationId;

    if (this.enableFile && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private write(level: LogLevel, message: string, data?: any): void {
    if (level < this.minLevel) return;

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const corrPart = this.correlationId ? ` [corr:${this.correlationId}]` : '';
    const formatted = `[${timestamp}] [${label}] [${this.context}]${corrPart} ${message}`;
    const withData = data !== undefined ? `${formatted} ${typeof data === 'string' ? data : JSON.stringify(data)}` : formatted;

    if (level >= LogLevel.WARN) {
      console.error(withData);
    } else {
      console.log(withData);
    }

    if (this.enableFile) {
      const dateStr = timestamp.slice(0, 10);
      const stream = getLogStream(this.logDir, dateStr);
      if (stream) {
        stream.write(withData + '\n');
      }
    }
  }

  debug(message: string, data?: any): void { this.write(LogLevel.DEBUG, message, data); }
  info(message: string, data?: any): void { this.write(LogLevel.INFO, message, data); }
  warn(message: string, data?: any): void { this.write(LogLevel.WARN, message, data); }
  error(message: string, data?: any): void { this.write(LogLevel.ERROR, message, data); }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, {
      logDir: this.logDir,
      minLevel: this.minLevel,
      enableFile: this.enableFile,
      correlationId: this.correlationId,
    });
  }

  withCorrelationId(correlationId: string): Logger {
    return new Logger(this.context, {
      logDir: this.logDir,
      minLevel: this.minLevel,
      enableFile: this.enableFile,
      correlationId,
    });
  }
}

const loggers = new Map<string, Logger>();

export function createLogger(context: string): Logger {
  const existing = loggers.get(context);
  if (existing) return existing;

  const logger = new Logger(context);
  loggers.set(context, logger);
  return logger;
}

export function createToolLogger(toolName: string, sessionId?: string): Logger {
  const context = `Tool:${toolName}`;
  const logger = new Logger(context, {
    correlationId: sessionId,
  });
  return logger;
}

export function createSubAgentLogger(role: string, sessionId?: string): Logger {
  const context = `SubAgent:${role}`;
  const logger = new Logger(context, {
    correlationId: sessionId,
  });
  return logger;
}

export function createApiLogger(endpoint: string): Logger {
  const context = `API:${endpoint}`;
  const logger = new Logger(context);
  return logger;
}

export function logToolExecution(
  toolName: string,
  sessionId: string | undefined,
  phase: 'start' | 'success' | 'error',
  data: { input?: any; output?: any; error?: string; durationMs?: number },
): void {
  const logger = createToolLogger(toolName, sessionId);
  const durationStr = data.durationMs !== undefined ? ` (${data.durationMs}ms)` : '';

  switch (phase) {
    case 'start':
      logger.info(`Executing ${toolName}${durationStr}`, {
        input: truncateForLog(data.input, 500),
      });
      break;
    case 'success':
      logger.info(`${toolName} completed${durationStr}`, {
        output: truncateForLog(data.output, 500),
        durationMs: data.durationMs,
      });
      break;
    case 'error':
      logger.error(`${toolName} failed${durationStr}`, {
        error: data.error,
        input: truncateForLog(data.input, 500),
        durationMs: data.durationMs,
      });
      break;
  }
}

export function logSubAgentEvent(
  role: string,
  sessionId: string | undefined,
  phase: 'start' | 'step' | 'success' | 'error' | 'timeout' | 'aborted',
  data: { task?: string; stepNumber?: number; result?: string; error?: string; durationMs?: number; stepsUsed?: number },
): void {
  const logger = createSubAgentLogger(role, sessionId);

  switch (phase) {
    case 'start':
      logger.info(`Sub-agent [${role}] starting`, {
        task: truncateForLog(data.task, 300),
      });
      break;
    case 'step':
      logger.debug(`Sub-agent [${role}] step ${data.stepNumber}`, {
        stepNumber: data.stepNumber,
      });
      break;
    case 'success':
      logger.info(`Sub-agent [${role}] completed`, {
        resultLength: data.result?.length ?? 0,
        stepsUsed: data.stepsUsed,
        durationMs: data.durationMs,
      });
      break;
    case 'error':
      logger.error(`Sub-agent [${role}] failed`, {
        error: data.error,
        durationMs: data.durationMs,
      });
      break;
    case 'timeout':
      logger.error(`Sub-agent [${role}] timed out`, {
        durationMs: data.durationMs,
      });
      break;
    case 'aborted':
      logger.warn(`Sub-agent [${role}] aborted`, {
        durationMs: data.durationMs,
      });
      break;
  }
}

export function logApiCall(
  endpoint: string,
  phase: 'request' | 'response' | 'error',
  data: { method?: string; url?: string; statusCode?: number; error?: string; durationMs?: number },
): void {
  const logger = createApiLogger(endpoint);

  switch (phase) {
    case 'request':
      logger.debug(`--> ${data.method ?? 'GET'} ${data.url ?? endpoint}`);
      break;
    case 'response':
      logger.debug(`<-- ${data.statusCode ?? 0} ${data.url ?? endpoint}${data.durationMs !== undefined ? ` (${data.durationMs}ms)` : ''}`);
      break;
    case 'error':
      logger.error(`XXX ${data.method ?? 'GET'} ${data.url ?? endpoint} failed`, {
        error: data.error,
        durationMs: data.durationMs,
      });
      break;
  }
}

function truncateForLog(value: any, maxLen: number): any {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    return value.length > maxLen ? value.slice(0, maxLen) + '...[truncated]' : value;
  }
  try {
    const str = JSON.stringify(value);
    if (str.length > maxLen) {
      return str.slice(0, maxLen) + '...[truncated]';
    }
    return value;
  } catch {
    return String(value).slice(0, maxLen);
  }
}
