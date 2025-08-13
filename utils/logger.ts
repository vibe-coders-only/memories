/**
 * Structured logging system with configurable levels
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getDatabasePath } from '../sync_engine/utils/paths.js';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export interface LogEntry {
  timestamp: string;
  level: keyof typeof LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface LoggerOptions {
  level?: LogLevel;
  outputFile?: string;
  outputConsole?: boolean;
  format?: 'json' | 'text';
  maxFileSize?: number; // bytes
  includeStackTrace?: boolean;
}

/**
 * Structured logger with multiple outputs and formats
 */
export class Logger {
  private level: LogLevel;
  private outputFile?: string;
  private outputConsole: boolean;
  private format: 'json' | 'text';
  private maxFileSize: number;
  private includeStackTrace: boolean;
  private context: Record<string, any> = {};
  
  constructor(private name: string, options: LoggerOptions = {}) {
    this.level = options.level ?? this.getLogLevelFromEnv();
    this.outputFile = options.outputFile;
    this.outputConsole = options.outputConsole ?? true;
    this.format = options.format ?? (process.env.LOG_FORMAT as 'json' | 'text') ?? 'text';
    this.maxFileSize = options.maxFileSize ?? 100 * 1024 * 1024; // 100MB default
    this.includeStackTrace = options.includeStackTrace ?? process.env.NODE_ENV !== 'production';
    
    // Ensure log directory exists
    if (this.outputFile) {
      const dir = dirname(this.outputFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Get log level from environment
   */
  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    
    switch (envLevel) {
      case 'ERROR': return LogLevel.ERROR;
      case 'WARN': return LogLevel.WARN;
      case 'INFO': return LogLevel.INFO;
      case 'DEBUG': return LogLevel.DEBUG;
      case 'TRACE': return LogLevel.TRACE;
      default: return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
  }
  
  /**
   * Set context that will be included in all log entries
   */
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }
  
  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }
  
  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.level;
  }
  
  /**
   * Format log entry
   */
  private formatEntry(entry: LogEntry): string {
    if (this.format === 'json') {
      return JSON.stringify({
        ...entry,
        logger: this.name,
        context: { ...this.context, ...entry.context }
      });
    }
    
    // Text format
    const levelStr = entry.level.padEnd(5);
    const timestamp = new Date(entry.timestamp).toISOString();
    let output = `[${timestamp}] ${levelStr} [${this.name}] ${entry.message}`;
    
    // Add context if present
    const fullContext = { ...this.context, ...entry.context };
    if (Object.keys(fullContext).length > 0) {
      output += ` ${JSON.stringify(fullContext)}`;
    }
    
    // Add error details
    if (entry.error) {
      output += `\n  Error: ${entry.error.message}`;
      if (entry.error.code) {
        output += ` (${entry.error.code})`;
      }
      if (entry.error.stack && this.includeStackTrace) {
        output += `\n${entry.error.stack.split('\n').map(line => '    ' + line).join('\n')}`;
      }
    }
    
    return output;
  }
  
  /**
   * Write log entry
   */
  private write(entry: LogEntry): void {
    const formatted = this.formatEntry(entry);
    
    // Console output
    if (this.outputConsole) {
      const colorMap = {
        ERROR: '\x1b[31m', // Red
        WARN: '\x1b[33m',  // Yellow
        INFO: '\x1b[36m',  // Cyan
        DEBUG: '\x1b[90m', // Gray
        TRACE: '\x1b[90m'  // Gray
      };
      
      const color = colorMap[entry.level] || '';
      const reset = '\x1b[0m';
      
      if (process.env.NO_COLOR || this.format === 'json') {
        console.log(formatted);
      } else {
        console.log(`${color}${formatted}${reset}`);
      }
    }
    
    // File output
    if (this.outputFile) {
      try {
        // Check file size and rotate if needed
        if (existsSync(this.outputFile)) {
          const { statSync } = require('fs');
          const stats = statSync(this.outputFile);
          
          if (stats.size > this.maxFileSize) {
            const rotatedFile = `${this.outputFile}.${Date.now()}`;
            const { renameSync } = require('fs');
            renameSync(this.outputFile, rotatedFile);
          }
        }
        
        appendFileSync(this.outputFile, formatted + '\n');
      } catch (error) {
        console.error('Failed to write log to file:', error);
      }
    }
  }
  
  /**
   * Log at a specific level
   */
  private log(
    level: LogLevel,
    levelName: keyof typeof LogLevel,
    message: string,
    context?: Record<string, any>
  ): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      context
    };
    
    this.write(entry);
  }
  
  /**
   * Log error with optional Error object
   */
  error(message: string, errorOrContext?: Error | Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message
    };
    
    if (errorOrContext instanceof Error) {
      entry.error = {
        message: errorOrContext.message,
        stack: errorOrContext.stack,
        code: (errorOrContext as any).code
      };
    } else if (errorOrContext) {
      entry.context = errorOrContext;
    }
    
    this.write(entry);
  }
  
  /**
   * Log warning
   */
  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, 'WARN', message, context);
  }
  
  /**
   * Log info
   */
  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, 'INFO', message, context);
  }
  
  /**
   * Log debug
   */
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, context);
  }
  
  /**
   * Log trace (most verbose)
   */
  trace(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.TRACE, 'TRACE', message, context);
  }
  
  /**
   * Create a child logger with additional context
   */
  child(name: string, context?: Record<string, any>): Logger {
    const child = new Logger(`${this.name}:${name}`, {
      level: this.level,
      outputFile: this.outputFile,
      outputConsole: this.outputConsole,
      format: this.format,
      maxFileSize: this.maxFileSize,
      includeStackTrace: this.includeStackTrace
    });
    
    child.setContext({ ...this.context, ...context });
    return child;
  }
  
  /**
   * Time a operation and log its duration
   */
  time(label: string): () => void {
    const start = Date.now();
    
    return () => {
      const duration = Date.now() - start;
      this.debug(`${label} completed`, { durationMs: duration });
    };
  }
}

/**
 * Global logger factory
 */
class LoggerFactory {
  private loggers: Map<string, Logger> = new Map();
  private defaultOptions: LoggerOptions = {};
  
  /**
   * Set default options for all loggers
   */
  configure(options: LoggerOptions): void {
    this.defaultOptions = options;
    
    // Update existing loggers
    for (const [name, logger] of this.loggers) {
      this.loggers.set(name, new Logger(name, options));
    }
  }
  
  /**
   * Get or create a logger
   */
  getLogger(name: string, options?: LoggerOptions): Logger {
    if (!this.loggers.has(name)) {
      this.loggers.set(name, new Logger(name, { ...this.defaultOptions, ...options }));
    }
    
    return this.loggers.get(name)!;
  }
  
  /**
   * Set global log level
   */
  setLevel(level: LogLevel): void {
    this.defaultOptions.level = level;
    
    for (const logger of this.loggers.values()) {
      (logger as any).level = level;
    }
  }
}

// Global logger factory instance
export const loggerFactory = new LoggerFactory();

// Configure from environment
const logFile = process.env.LOG_FILE || 
               (process.env.NODE_ENV === 'production' 
                 ? join(dirname(getDatabasePath()), 'logs', 'mem-sqlite.log')
                 : undefined);

loggerFactory.configure({
  outputFile: logFile,
  outputConsole: process.env.LOG_CONSOLE !== 'false',
  format: (process.env.LOG_FORMAT as 'json' | 'text') || 'text'
});

/**
 * Get a logger instance
 */
export function getLogger(name: string): Logger {
  return loggerFactory.getLogger(name);
}

// Export convenience loggers
export const rootLogger = getLogger('mem-sqlite');
export const syncLogger = getLogger('sync');
export const dbLogger = getLogger('database');
export const mcpLogger = getLogger('mcp');