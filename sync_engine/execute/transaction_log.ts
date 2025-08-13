import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getTransactionLogPath, getBasePath } from '../utils/paths';

export interface DatabaseTransaction {
  timestamp: string;
  operation: 'insert' | 'update' | 'delete';
  table: string;
  sessionId: string;
  messageId?: string;
  changes: any;
}

export class TransactionLogger {
  private static instance: TransactionLogger;
  private logPath: string;
  
  static getInstance(): TransactionLogger {
    if (!TransactionLogger.instance) {
      TransactionLogger.instance = new TransactionLogger();
    }
    return TransactionLogger.instance;
  }
  
  // For testing: reset singleton instance
  static resetInstance(): void {
    TransactionLogger.instance = undefined as any;
  }
  
  private constructor() {
    this.logPath = process.env.TEST_LOG_PATH || getTransactionLogPath();
    // Ensure log directory exists
    const logDir = dirname(this.logPath);
    mkdirSync(logDir, { recursive: true });
  }
  
  logTransaction(transaction: DatabaseTransaction): void {
    const logEntry = {
      ...transaction,
      timestamp: new Date().toISOString(),
      logId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    const jsonLine = JSON.stringify(logEntry) + '\n';
    
    try {
      appendFileSync(this.logPath, jsonLine, 'utf8');
      console.log(`DB_LOG: ${transaction.operation} ${transaction.table} for session ${transaction.sessionId}`);
    } catch (error) {
      console.error('Failed to write transaction log:', error);
    }
  }
  
  logSessionInsert(sessionId: string, sessionPath: string): void {
    this.logTransaction({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'sessions',
      sessionId,
      changes: { sessionPath }
    });
  }
  
  logMessageInsert(sessionId: string, messageId: string, messageType: string): void {
    this.logTransaction({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId,
      messageId,
      changes: { type: messageType }
    });
  }
  
  logToolUseInsert(sessionId: string, messageId: string, toolId: string, toolName: string): void {
    this.logTransaction({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'tool_uses',
      sessionId,
      messageId,
      changes: { toolId, toolName }
    });
  }
  
  logToolResultInsert(sessionId: string, messageId: string, toolUseId: string): void {
    this.logTransaction({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'tool_use_results',
      sessionId,
      messageId,
      changes: { toolUseId }
    });
  }

  logBatchOperation(sessionId: string, operation: string, count: number): void {
    this.logTransaction({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'batch_operation',
      sessionId,
      changes: { operation, count }
    });
  }
  
  getLogPath(): string {
    return this.logPath;
  }
}