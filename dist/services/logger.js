import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
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
const streamCache = new Map();
function getLogStream(logDir, dateStr) {
    const key = `${logDir}:${dateStr}`;
    let stream = streamCache.get(key);
    if (stream && !stream.destroyed)
        return stream;
    try {
        const logFile = resolve(logDir, `${dateStr}.log`);
        stream = createWriteStream(logFile, { flags: 'a' });
        stream.on('error', () => {
            streamCache.delete(key);
        });
        streamCache.set(key, stream);
        return stream;
    }
    catch {
        return null;
    }
}
process.on('exit', () => {
    for (const stream of streamCache.values()) {
        if (!stream.destroyed)
            stream.end();
    }
});
export class Logger {
    context;
    logDir;
    minLevel;
    enableFile;
    correlationId;
    constructor(context, options) {
        this.context = context;
        this.logDir = options?.logDir ?? resolve(process.cwd(), 'data', 'logs');
        this.minLevel = options?.minLevel ?? (process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL.toUpperCase()] : LogLevel.DEBUG);
        this.enableFile = options?.enableFile ?? (process.env.LOG_FILE !== 'false');
        this.correlationId = options?.correlationId;
        if (this.enableFile && !existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true });
        }
    }
    write(level, message, data) {
        if (level < this.minLevel)
            return;
        const timestamp = new Date().toISOString();
        const label = LEVEL_LABELS[level];
        const corrPart = this.correlationId ? ` [corr:${this.correlationId}]` : '';
        const formatted = `[${timestamp}] [${label}] [${this.context}]${corrPart} ${message}`;
        const withData = data !== undefined ? `${formatted} ${typeof data === 'string' ? data : JSON.stringify(data)}` : formatted;
        if (level >= LogLevel.WARN) {
            console.error(withData);
        }
        else {
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
    debug(message, data) { this.write(LogLevel.DEBUG, message, data); }
    info(message, data) { this.write(LogLevel.INFO, message, data); }
    warn(message, data) { this.write(LogLevel.WARN, message, data); }
    error(message, data) { this.write(LogLevel.ERROR, message, data); }
    child(subContext) {
        return new Logger(`${this.context}:${subContext}`, {
            logDir: this.logDir,
            minLevel: this.minLevel,
            enableFile: this.enableFile,
            correlationId: this.correlationId,
        });
    }
    withCorrelationId(correlationId) {
        return new Logger(this.context, {
            logDir: this.logDir,
            minLevel: this.minLevel,
            enableFile: this.enableFile,
            correlationId,
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
export function createToolLogger(toolName, sessionId) {
    const context = `Tool:${toolName}`;
    const logger = new Logger(context, {
        correlationId: sessionId,
    });
    return logger;
}
export function createSubAgentLogger(role, sessionId) {
    const context = `SubAgent:${role}`;
    const logger = new Logger(context, {
        correlationId: sessionId,
    });
    return logger;
}
export function createApiLogger(endpoint) {
    const context = `API:${endpoint}`;
    const logger = new Logger(context);
    return logger;
}
export function logToolExecution(toolName, sessionId, phase, data) {
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
export function logSubAgentEvent(role, sessionId, phase, data) {
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
export function logApiCall(endpoint, phase, data) {
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
function truncateForLog(value, maxLen) {
    if (value === undefined || value === null)
        return value;
    if (typeof value === 'string') {
        return value.length > maxLen ? value.slice(0, maxLen) + '...[truncated]' : value;
    }
    try {
        const str = JSON.stringify(value);
        if (str.length > maxLen) {
            return str.slice(0, maxLen) + '...[truncated]';
        }
        return value;
    }
    catch {
        return String(value).slice(0, maxLen);
    }
}
//# sourceMappingURL=logger.js.map