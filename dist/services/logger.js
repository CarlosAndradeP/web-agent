import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
const LEVEL_LABELS = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
};
export class Logger {
    context;
    logDir;
    minLevel;
    enableFile;
    constructor(context, options) {
        this.context = context;
        this.logDir = options?.logDir ?? resolve(process.cwd(), 'data', 'logs');
        this.minLevel = options?.minLevel ?? (process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL.toUpperCase()] : LogLevel.DEBUG);
        this.enableFile = options?.enableFile ?? (process.env.LOG_FILE !== 'false');
        if (this.enableFile && !existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true });
        }
    }
    write(level, message, data) {
        if (level < this.minLevel)
            return;
        const timestamp = new Date().toISOString();
        const label = LEVEL_LABELS[level];
        const formatted = `[${timestamp}] [${label}] [${this.context}] ${message}`;
        const withData = data !== undefined ? `${formatted} ${typeof data === 'string' ? data : JSON.stringify(data)}` : formatted;
        if (level >= LogLevel.WARN) {
            console.error(withData);
        }
        else if (level >= LogLevel.INFO) {
            console.log(withData);
        }
        else {
            console.log(withData);
        }
        if (this.enableFile) {
            try {
                const logFile = resolve(this.logDir, `${new Date().toISOString().slice(0, 10)}.log`);
                appendFileSync(logFile, withData + '\n', 'utf-8');
            }
            catch { }
        }
    }
    debug(message, data) { this.write(LogLevel.DEBUG, message, data); }
    info(message, data) { this.write(LogLevel.INFO, message, data); }
    warn(message, data) { this.write(LogLevel.WARN, message, data); }
    error(message, data) { this.write(LogLevel.ERROR, message, data); }
    child(subContext) {
        return new Logger(`${this.context}:${subContext}`, {
            logDir: this.logDir,
            minLevel: this.minLevel,
            enableFile: this.enableFile,
        });
    }
}
const loggers = new Map();
export function createLogger(context) {
    const existing = loggers.get(context);
    if (existing)
        return existing;
    const logger = new Logger(context);
    loggers.set(context, logger);
    return logger;
}
//# sourceMappingURL=logger.js.map