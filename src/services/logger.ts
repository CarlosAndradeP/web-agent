import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

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

export class Logger {
  private context: string;
  private logDir: string;
  private minLevel: LogLevel;
  private enableFile: boolean;

  constructor(context: string, options?: { logDir?: string; minLevel?: LogLevel; enableFile?: boolean }) {
    this.context = context;
    this.logDir = options?.logDir ?? resolve(process.cwd(), 'data', 'logs');
    this.minLevel = options?.minLevel ?? (process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL.toUpperCase() as keyof typeof LogLevel] as LogLevel : LogLevel.DEBUG);
    this.enableFile = options?.enableFile ?? (process.env.LOG_FILE !== 'false');

    if (this.enableFile && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private write(level: LogLevel, message: string, data?: any): void {
    if (level < this.minLevel) return;

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const formatted = `[${timestamp}] [${label}] [${this.context}] ${message}`;
    const withData = data !== undefined ? `${formatted} ${typeof data === 'string' ? data : JSON.stringify(data)}` : formatted;

    if (level >= LogLevel.WARN) {
      console.error(withData);
    } else if (level >= LogLevel.INFO) {
      console.log(withData);
    } else {
      console.log(withData);
    }

    if (this.enableFile) {
      try {
        const logFile = resolve(this.logDir, `${new Date().toISOString().slice(0, 10)}.log`);
        appendFileSync(logFile, withData + '\n', 'utf-8');
      } catch {}
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
