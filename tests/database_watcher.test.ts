import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseWatcher } from '../sync_engine/watchers/database_watcher.js';
import { writeFileSync, appendFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database Watcher', () => {
  let testDir: string;
  let testLogPath: string;
  let watcher: DatabaseWatcher;
  
  beforeEach(() => {
    // Create unique test directory for each test
    testDir = join(tmpdir(), `memories-watcher-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    testLogPath = join(testDir, 'memories_db_changes.jsonl');
    mkdirSync(testDir, { recursive: true });
    
    watcher = new DatabaseWatcher(testLogPath);
  });
  
  afterEach(async () => {
    // Stop watcher and clean up
    if (watcher.isWatching()) {
      watcher.stop();
    }
    
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  it('should initialize with correct log path', () => {
    expect(watcher.getLogPath()).toBe(testLogPath);
    expect(watcher.isWatching()).toBe(false);
  });
  
  it('should start and stop watching correctly', () => {
    // Create log file first
    writeFileSync(testLogPath, '');
    
    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });
  
  it('should emit started and stopped events', async () => {
    const startedPromise = new Promise(resolve => {
      watcher.once('started', resolve);
    });
    
    const stoppedPromise = new Promise(resolve => {
      watcher.once('stopped', resolve);
    });
    
    // Create log file first
    writeFileSync(testLogPath, '');
    
    watcher.start();
    await startedPromise;
    
    watcher.stop();
    await stoppedPromise;
  });
  
  it('should detect new log entries and emit change events', async () => {
    // Create initial empty log file
    writeFileSync(testLogPath, '');
    
    const changePromise = new Promise(resolve => {
      watcher.once('change', resolve);
    });
    
    watcher.start();
    
    // Wait a bit for watcher to initialize
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Add new log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId: 'test-session',
      messageId: 'test-message',
      changes: { type: 'user' },
      logId: 'test-log-id'
    };
    
    appendFileSync(testLogPath, JSON.stringify(logEntry) + '\n');
    
    const change = await changePromise;
    expect(change).toEqual(logEntry);
  });
  
  it('should emit specific table operation events', async () => {
    writeFileSync(testLogPath, '');
    
    const messageInsertPromise = new Promise(resolve => {
      watcher.once('insert_messages', resolve);
    });
    
    watcher.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId: 'test-session',
      changes: { type: 'assistant' },
      logId: 'test-log-id-2'
    };
    
    appendFileSync(testLogPath, JSON.stringify(logEntry) + '\n');
    
    const change = await messageInsertPromise;
    expect(change).toEqual(logEntry);
  });
  
  it('should provide convenience methods for specific events', async () => {
    writeFileSync(testLogPath, '');
    
    const sessionInsertPromise = new Promise(resolve => {
      watcher.onSessionInsert(resolve);
    });
    
    const messageInsertPromise = new Promise(resolve => {
      watcher.onMessageInsert(resolve);
    });
    
    const batchPromise = new Promise(resolve => {
      watcher.onBatchOperation(resolve);
    });
    
    watcher.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Test session insert
    appendFileSync(testLogPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'sessions',
      sessionId: 'session-1',
      changes: { sessionPath: '/test/path' },
      logId: 'log-1'
    }) + '\n');
    
    // Test message insert
    appendFileSync(testLogPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId: 'session-1',
      messageId: 'msg-1',
      changes: { type: 'user' },
      logId: 'log-2'
    }) + '\n');
    
    // Test batch operation
    appendFileSync(testLogPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'batch_operation',
      sessionId: 'session-1',
      changes: { operation: 'sync_complete', count: 5 },
      logId: 'log-3'
    }) + '\n');
    
    const [sessionChange, messageChange, batchChange] = await Promise.all([
      sessionInsertPromise,
      messageInsertPromise,
      batchPromise
    ]);
    
    expect(sessionChange.table).toBe('sessions');
    expect(messageChange.table).toBe('messages');
    expect(batchChange.table).toBe('batch_operation');
  });
  
  it('should handle malformed JSON entries gracefully', async () => {
    writeFileSync(testLogPath, '');
    
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    watcher.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Add malformed JSON
    appendFileSync(testLogPath, 'invalid json\n');
    
    // Add valid JSON after malformed
    const validEntry = {
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId: 'test',
      changes: {},
      logId: 'test'
    };
    
    const changePromise = new Promise(resolve => {
      watcher.once('change', resolve);
    });
    
    appendFileSync(testLogPath, JSON.stringify(validEntry) + '\n');
    
    const change = await changePromise;
    expect(change).toEqual(validEntry);
    expect(errorSpy).toHaveBeenCalled();
    
    errorSpy.mockRestore();
  });
  
  it('should handle multiple rapid entries correctly', async () => {
    writeFileSync(testLogPath, '');
    
    const changes: any[] = [];
    watcher.on('change', (change) => changes.push(change));
    
    watcher.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Add multiple entries rapidly
    const entries = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      operation: 'insert',
      table: 'messages',
      sessionId: `session-${i}`,
      changes: { type: 'user' },
      logId: `log-${i}`
    }));
    
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(testLogPath, content);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    expect(changes).toHaveLength(5);
    expect(changes.map(c => c.sessionId)).toEqual(['session-0', 'session-1', 'session-2', 'session-3', 'session-4']);
  });
  
  it('should handle file that does not exist initially', () => {
    // Don't create the file
    expect(() => watcher.start()).not.toThrow();
    expect(watcher.isWatching()).toBe(true);
  });
});