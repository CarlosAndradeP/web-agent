export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export declare class Logger {
    private context;
    private logDir;
    private minLevel;
    private enableFile;
    private correlationId?;
    constructor(context: string, options?: {
        logDir?: string;
        minLevel?: LogLevel;
        enableFile?: boolean;
        correlationId?: string;
    });
    private write;
    debug(message: string, data?: any): void;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
    child(subContext: string): Logger;
    withCorrelationId(correlationId: string): Logger;
}
export declare function createLogger(context: string): Logger;
export declare function createToolLogger(toolName: string, sessionId?: string): Logger;
export declare function createSubAgentLogger(role: string, sessionId?: string): Logger;
export declare function createApiLogger(endpoint: string): Logger;
export declare function logToolExecution(toolName: string, sessionId: string | undefined, phase: 'start' | 'success' | 'error', data: {
    input?: any;
    output?: any;
    error?: string;
    durationMs?: number;
}): void;
export declare function logSubAgentEvent(role: string, sessionId: string | undefined, phase: 'start' | 'step' | 'success' | 'error' | 'timeout' | 'aborted', data: {
    task?: string;
    stepNumber?: number;
    result?: string;
    error?: string;
    durationMs?: number;
    stepsUsed?: number;
}): void;
export declare function logApiCall(endpoint: string, phase: 'request' | 'response' | 'error', data: {
    method?: string;
    url?: string;
    statusCode?: number;
    error?: string;
    durationMs?: number;
}): void;
//# sourceMappingURL=logger.d.ts.map