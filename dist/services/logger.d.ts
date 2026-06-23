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
    constructor(context: string, options?: {
        logDir?: string;
        minLevel?: LogLevel;
        enableFile?: boolean;
    });
    private write;
    debug(message: string, data?: any): void;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
    child(subContext: string): Logger;
}
export declare function createLogger(context: string): Logger;
//# sourceMappingURL=logger.d.ts.map