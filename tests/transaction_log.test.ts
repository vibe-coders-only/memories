import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionLogger } from '../sync_engine/execute/transaction_log.js';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Transaction Logger', () => {
  let testDir: string;
  let testLogPath: string;
  let logger: TransactionLogger;
  
  beforeEach(() => {
    // Create unique test directory for each test
    testDir = join(tmpdir(), `memories-sync-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    testLogPath = join(testDir, 'memories_db_changes.jsonl');
    mkdirSync(testDir, { recursive: true });
    
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOG_PATH = testLogPath;
    
    // Reset singleton for fresh instance per test
    TransactionLogger.resetInstance();
  });
  
  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    
    // Reset environment
    delete process.env.TEST_LOG_PATH;
    if (process.env.NODE_ENV === 'test') {
      delete process.env.NODE_ENV;
    }
  });
  
  it('should create transaction log file', () => {
    // Mock the logger to use test path
    const logger = TransactionLogger.getInstance();
    // Hack: Override the log path for testing
    (logger as any).logPath = testLogPath;
    
    logger.logSessionInsert('test-session-123', '/test/path.jsonl');
    
    expect(existsSync(testLogPath)).toBe(true);
  });
  
  it('should log session insertion correctly', () => {
    const logger = TransactionLogger.getInstance();
    (logger as any).logPath = testLogPath;
    
    logger.logSessionInsert('session-abc', '/path/to/session.jsonl');
    
    const content = readFileSync(testLogPath, 'utf8');
    const entry = JSON.parse(content.trim());
    
    expect(entry.operation).toBe('insert');
    expect(entry.table).toBe('sessions');
    expect(entry.sessionId).toBe('session-abc');
    expect(entry.changes.sessionPath).toBe('/path/to/session.jsonl');
    expect(entry.timestamp).toBeDefined();
    expect(entry.logId).toBeDefined();
  });
  
  it('should log message insertion correctly', () => {
    const logger = TransactionLogger.getInstance();
    (logger as any).logPath = testLogPath;
    
    logger.logMessageInsert('session-123', 'msg-456', 'user');
    
    const content = readFileSync(testLogPath, 'utf8');
    const entry = JSON.parse(content.trim());
    
    expect(entry.operation).toBe('insert');
    expect(entry.table).toBe('messages');
    expect(entry.sessionId).toBe('session-123');
    expect(entry.messageId).toBe('msg-456');
    expect(entry.changes.type).toBe('user');
  });
  
  it('should log batch operations correctly', () => {
    const logger = TransactionLogger.getInstance();
    (logger as any).logPath = testLogPath;
    
    logger.logBatchOperation('session-789', 'sync_complete', 42);
    
    const content = readFileSync(testLogPath, 'utf8');
    const entry = JSON.parse(content.trim());
    
    expect(entry.operation).toBe('insert');
    expect(entry.table).toBe('batch_operation');
    expect(entry.sessionId).toBe('session-789');
    expect(entry.changes.operation).toBe('sync_complete');
    expect(entry.changes.count).toBe(42);
  });
  
  it('should append multiple entries to same file', () => {
    const logger = TransactionLogger.getInstance();
    (logger as any).logPath = testLogPath;
    
    logger.logSessionInsert('session-1', '/path1.jsonl');
    logger.logMessageInsert('session-1', 'msg-1', 'user');
    logger.logMessageInsert('session-1', 'msg-2', 'assistant');
    
    const content = readFileSync(testLogPath, 'utf8');
    const lines = content.trim().split('\n');
    
    expect(lines).toHaveLength(3);
    
    const entries = lines.map(line => JSON.parse(line));
    expect(entries[0].table).toBe('sessions');
    expect(entries[1].table).toBe('messages');
    expect(entries[2].table).toBe('messages');
    expect(entries[1].changes.type).toBe('user');
    expect(entries[2].changes.type).toBe('assistant');
  });
  
  it('should handle singleton pattern correctly', () => {
    const logger1 = TransactionLogger.getInstance();
    const logger2 = TransactionLogger.getInstance();
    
    expect(logger1).toBe(logger2);
  });
  
  it('should include unique log IDs', () => {
    const logger = TransactionLogger.getInstance();
    (logger as any).logPath = testLogPath;
    
    logger.logSessionInsert('session-1', '/path1.jsonl');
    logger.logSessionInsert('session-2', '/path2.jsonl');
    
    const content = readFileSync(testLogPath, 'utf8');
    const lines = content.trim().split('\n');
    const entries = lines.map(line => JSON.parse(line));
    
    expect(entries[0].logId).toBeDefined();
    expect(entries[1].logId).toBeDefined();
    expect(entries[0].logId).not.toBe(entries[1].logId);
  });
  
  it('should handle file write errors gracefully', () => {
    const logger = TransactionLogger.getInstance();
    // Set invalid path that can't be written to
    (logger as any).logPath = '/root/invalid/path/log.jsonl';
    
    // Should not throw error
    expect(() => {
      logger.logSessionInsert('session-test', '/path.jsonl');
    }).not.toThrow();
  });
});