/**
 * Enhanced error handling with context and structured error messages
 */

export interface ErrorContext {
  operation?: string;
  table?: string;
  file?: string;
  sql?: string;
  params?: any[];
  sessionId?: string;
  messageId?: string;
  lineNumber?: number;
  retryCount?: number;
  duration?: number;
  [key: string]: any;
}

/**
 * Base error class with context
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly isRetryable: boolean;
  
  constructor(
    message: string,
    code: string,
    context: ErrorContext = {},
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.isRetryable = isRetryable;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
  
  /**
   * Get detailed error message with context
   */
  getDetailedMessage(): string {
    let details = `[${this.code}] ${this.message}`;
    
    if (this.context.operation) {
      details += `\n  Operation: ${this.context.operation}`;
    }
    
    if (this.context.file) {
      details += `\n  File: ${this.context.file}`;
      if (this.context.lineNumber) {
        details += `:${this.context.lineNumber}`;
      }
    }
    
    if (this.context.table) {
      details += `\n  Table: ${this.context.table}`;
    }
    
    if (this.context.sql) {
      details += `\n  SQL: ${this.context.sql.substring(0, 200)}${this.context.sql.length > 200 ? '...' : ''}`;
    }
    
    if (this.context.sessionId) {
      details += `\n  Session: ${this.context.sessionId}`;
    }
    
    if (this.context.retryCount) {
      details += `\n  Retry attempt: ${this.context.retryCount}`;
    }
    
    if (this.context.duration) {
      details += `\n  Duration: ${this.context.duration}ms`;
    }
    
    return details;
  }
  
  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      isRetryable: this.isRetryable,
      stack: this.stack
    };
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'DB_ERROR', context, true);
  }
}

export class ConnectionError extends DatabaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'DB_CONNECTION', context);
    this.code = 'DB_CONNECTION';
  }
}

export class QueryError extends DatabaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'DB_QUERY', context);
    this.code = 'DB_QUERY';
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'DB_FK_CONSTRAINT', context);
    this.code = 'DB_FK_CONSTRAINT';
  }
}

export class LockError extends DatabaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'DB_LOCK', context);
    this.code = 'DB_LOCK';
  }
}

/**
 * File processing errors
 */
export class FileError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'FILE_ERROR', context, false);
  }
}

export class ParseError extends FileError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'PARSE_ERROR', context);
    this.code = 'PARSE_ERROR';
  }
}

export class ValidationError extends FileError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'VALIDATION_ERROR', context);
    this.code = 'VALIDATION_ERROR';
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'CONFIG_ERROR', context, false);
  }
}

/**
 * MCP server errors
 */
export class MCPError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'MCP_ERROR', context, false);
  }
}

export class RateLimitError extends MCPError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'RATE_LIMIT', context);
    this.code = 'RATE_LIMIT';
    this.isRetryable = true;
  }
}

/**
 * Error formatter for consistent error messages
 */
export class ErrorFormatter {
  /**
   * Format database error with full context
   */
  static formatDatabaseError(error: any, operation: string, context: ErrorContext = {}): string {
    const baseContext = {
      operation,
      ...context
    };
    
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return new ForeignKeyError(
        `Foreign key constraint failed during ${operation}`,
        baseContext
      ).getDetailedMessage();
    }
    
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
      return new LockError(
        `Database locked during ${operation}`,
        baseContext
      ).getDetailedMessage();
    }
    
    if (error.code === 'SQLITE_ERROR') {
      return new QueryError(
        `SQL error during ${operation}: ${error.message}`,
        baseContext
      ).getDetailedMessage();
    }
    
    return new DatabaseError(
      `Database error during ${operation}: ${error.message}`,
      baseContext
    ).getDetailedMessage();
  }
  
  /**
   * Format file processing error
   */
  static formatFileError(error: any, file: string, context: ErrorContext = {}): string {
    const baseContext = {
      file,
      ...context
    };
    
    if (error.code === 'ENOENT') {
      return new FileError(
        `File not found: ${file}`,
        baseContext
      ).getDetailedMessage();
    }
    
    if (error.code === 'EACCES') {
      return new FileError(
        `Permission denied accessing file: ${file}`,
        baseContext
      ).getDetailedMessage();
    }
    
    if (error instanceof SyntaxError) {
      return new ParseError(
        `JSON parse error in ${file}: ${error.message}`,
        baseContext
      ).getDetailedMessage();
    }
    
    return new FileError(
      `File processing error for ${file}: ${error.message}`,
      baseContext
    ).getDetailedMessage();
  }
  
  /**
   * Create user-friendly error message
   */
  static getUserMessage(error: any): string {
    if (error instanceof AppError) {
      switch (error.code) {
        case 'DB_CONNECTION':
          return 'Unable to connect to database. Please check if the service is running.';
        case 'DB_FK_CONSTRAINT':
          return 'Data integrity error. Some related records may be missing.';
        case 'DB_LOCK':
          return 'Database is busy. Please try again in a moment.';
        case 'PARSE_ERROR':
          return 'Invalid data format encountered. Please check the input files.';
        case 'VALIDATION_ERROR':
          return 'Data validation failed. Please check the data format.';
        case 'RATE_LIMIT':
          return 'Rate limit exceeded. Please slow down your requests.';
        case 'CONFIG_ERROR':
          return 'Configuration error. Please check your settings.';
        default:
          return error.message;
      }
    }
    
    return 'An unexpected error occurred. Please check the logs for details.';
  }
}

/**
 * Error aggregator for batch operations
 */
export class ErrorAggregator {
  private errors: AppError[] = [];
  private context: ErrorContext;
  
  constructor(context: ErrorContext = {}) {
    this.context = context;
  }
  
  /**
   * Add an error to the aggregator
   */
  add(error: any, additionalContext: ErrorContext = {}): void {
    if (error instanceof AppError) {
      error.context = { ...this.context, ...error.context, ...additionalContext };
      this.errors.push(error);
    } else {
      this.errors.push(
        new AppError(
          error.message || String(error),
          'UNKNOWN',
          { ...this.context, ...additionalContext }
        )
      );
    }
  }
  
  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
  
  /**
   * Get error count
   */
  count(): number {
    return this.errors.length;
  }
  
  /**
   * Get all errors
   */
  getErrors(): AppError[] {
    return [...this.errors];
  }
  
  /**
   * Get summary of errors
   */
  getSummary(): string {
    if (this.errors.length === 0) {
      return 'No errors';
    }
    
    const byCode = new Map<string, number>();
    for (const error of this.errors) {
      byCode.set(error.code, (byCode.get(error.code) || 0) + 1);
    }
    
    const summary = [`${this.errors.length} total errors:`];
    for (const [code, count] of byCode) {
      summary.push(`  - ${code}: ${count}`);
    }
    
    return summary.join('\n');
  }
  
  /**
   * Clear all errors
   */
  clear(): void {
    this.errors = [];
  }
}

/**
 * Wrap async function with error handling
 */
export function withErrorHandling<T>(
  fn: (...args: any[]) => Promise<T>,
  context: ErrorContext = {}
): (...args: any[]) => Promise<T> {
  return async (...args: any[]): Promise<T> => {
    const startTime = Date.now();
    
    try {
      return await fn(...args);
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof AppError) {
        error.context = { ...error.context, ...context, duration };
        throw error;
      }
      
      throw new AppError(
        error instanceof Error ? error.message : String(error),
        'UNHANDLED_ERROR',
        { ...context, duration, originalError: error },
        false
      );
    }
  };
}