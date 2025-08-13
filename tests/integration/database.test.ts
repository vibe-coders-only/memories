/**
 * Integration tests for database operations
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { DatabaseConnectionManager } from '../../database/connection.js';
import { initializeDatabase } from '../../sync_engine/execute/schema.js';
import { executeParsedEntries } from '../../sync_engine/execute/database.js';
import { RetentionService } from '../../maintenance/retention.js';
import { BackupService } from '../../maintenance/backup.js';
import { DatabasePool } from '../../sync_engine/utils/connection_pool.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(__dirname, '../temp/test.db');
const TEST_BACKUP_PATH = join(__dirname, '../temp/backups');

describe('Database Integration Tests', () => {
  let dbManager: DatabaseConnectionManager;
  let testDb: any;
  
  beforeAll(() => {
    // Create test directories
    mkdirSync(join(__dirname, '../temp'), { recursive: true });
    mkdirSync(TEST_BACKUP_PATH, { recursive: true });
    
    // Initialize test database
    process.env.DATABASE_PATH = TEST_DB_PATH;
    testDb = initializeDatabase();
  });
  
  afterAll(() => {
    // Clean up
    if (testDb) testDb.close();
    rmSync(join(__dirname, '../temp'), { recursive: true, force: true });
  });
  
  beforeEach(() => {
    // Clear test data between tests
    if (testDb) {
      testDb.exec(`
        DELETE FROM tool_use_results;
        DELETE FROM tool_uses;
        DELETE FROM attachments;
        DELETE FROM env_info;
        DELETE FROM messages;
        DELETE FROM sessions;
      `);
    }
  });
  
  describe('Connection Management', () => {
    test('should create read-write connection', () => {
      const manager = DatabaseConnectionManager.getInstance();
      const db = manager.getReadWriteConnection();
      
      expect(db).toBeDefined();
      
      // Test write operation
      const result = db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
        'test-1',
        'session-1',
        '/test/path'
      );
      
      expect(result.changes).toBe(1);
    });
    
    test('should create read-only connection', () => {
      const manager = DatabaseConnectionManager.getInstance();
      const db = manager.getReadOnlyConnection();
      
      expect(db).toBeDefined();
      
      // Test read operation
      const result = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;
      expect(result.count).toBeGreaterThanOrEqual(0);
      
      // Test that write operations fail
      expect(() => {
        db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
          'test-2',
          'session-2',
          '/test/path2'
        );
      }).toThrow();
    });
    
    test('should manage connection pool', async () => {
      const manager = DatabaseConnectionManager.getInstance();
      const pool = manager.getPool();
      
      expect(pool).toBeDefined();
      
      // Acquire multiple connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      
      expect(conn1).toBeDefined();
      expect(conn2).toBeDefined();
      expect(conn1.id).not.toBe(conn2.id);
      
      // Release connections
      pool.release(conn1);
      pool.release(conn2);
      
      // Check pool stats
      const stats = pool.getStats();
      expect(stats.totalConnections).toBeGreaterThanOrEqual(2);
    });
  });
  
  describe('Transaction Management', () => {
    test('should execute transactions atomically', () => {
      const manager = DatabaseConnectionManager.getInstance();
      
      // Test successful transaction
      const result1 = manager.executeTransaction((db) => {
        db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
          'trans-1',
          'session-trans-1',
          '/trans/path1'
        );
        
        db.prepare('INSERT INTO messages (id, sessionId, type, timestamp) VALUES (?, ?, ?, ?)').run(
          'msg-trans-1',
          'session-trans-1',
          'user',
          new Date().toISOString()
        );
        
        return true;
      });
      
      expect(result1).toBe(true);
      
      // Verify data was inserted
      const count = testDb.prepare('SELECT COUNT(*) as count FROM messages WHERE sessionId = ?').get('session-trans-1') as any;
      expect(count.count).toBe(1);
      
      // Test failed transaction (should rollback)
      expect(() => {
        manager.executeTransaction((db) => {
          db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
            'trans-2',
            'session-trans-2',
            '/trans/path2'
          );
          
          // This should fail due to foreign key constraint
          db.prepare('INSERT INTO messages (id, sessionId, type, timestamp) VALUES (?, ?, ?, ?)').run(
            'msg-trans-2',
            'non-existent-session',
            'user',
            new Date().toISOString()
          );
        });
      }).toThrow();
      
      // Verify rollback
      const rollbackCheck = testDb.prepare('SELECT COUNT(*) as count FROM sessions WHERE id = ?').get('trans-2') as any;
      expect(rollbackCheck.count).toBe(0);
    });
  });
  
  describe('Data Insertion with FK Constraints', () => {
    test('should handle foreign key constraints correctly', () => {
      const parsedEntries = [
        {
          session: {
            id: 'sess-fk-1',
            sessionId: 'sess-fk-1',
            sessionPath: '/test/fk'
          },
          message: {
            id: 'msg-fk-1',
            sessionId: 'sess-fk-1',
            type: 'user',
            timestamp: new Date().toISOString(),
            isSidechain: false,
            projectName: null,
            activeFile: null,
            userText: 'Test message',
            userType: 'text',
            userAttachments: null,
            toolUseResultId: null,
            toolUseResultName: null,
            assistantRole: null,
            assistantText: null,
            assistantModel: null
          },
          toolUses: [
            {
              id: 'tool-fk-1',
              messageId: 'msg-fk-1',
              toolId: 'tool-1',
              toolName: 'test_tool',
              parameters: JSON.stringify({ test: true })
            }
          ],
          toolResults: [
            {
              id: 'result-fk-1',
              toolUseId: 'tool-fk-1',
              messageId: 'msg-fk-1',
              output: 'Test output',
              outputMimeType: 'text/plain',
              error: null,
              errorType: null
            }
          ],
          attachments: [],
          envInfo: null,
          errors: []
        }
      ];
      
      const result = executeParsedEntries(parsedEntries);
      
      expect(result.messagesInserted).toBe(1);
      expect(result.toolUsesInserted).toBe(1);
      expect(result.toolResultsInserted).toBe(1);
      expect(result.errors.length).toBe(0);
      
      // Verify cascade delete
      testDb.prepare('DELETE FROM messages WHERE id = ?').run('msg-fk-1');
      
      const toolUseCount = testDb.prepare('SELECT COUNT(*) as count FROM tool_uses WHERE messageId = ?').get('msg-fk-1') as any;
      expect(toolUseCount.count).toBe(0);
      
      const toolResultCount = testDb.prepare('SELECT COUNT(*) as count FROM tool_use_results WHERE messageId = ?').get('msg-fk-1') as any;
      expect(toolResultCount.count).toBe(0);
    });
  });
  
  describe('Retention Service', () => {
    test('should clean old data correctly', async () => {
      // Insert test data with old timestamps
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days old
      
      testDb.prepare('INSERT INTO sessions (id, sessionId, sessionPath, created) VALUES (?, ?, ?, ?)').run(
        'old-sess-1',
        'old-sess-1',
        '/old/path',
        oldDate.toISOString()
      );
      
      testDb.prepare('INSERT INTO messages (id, sessionId, type, timestamp) VALUES (?, ?, ?, ?)').run(
        'old-msg-1',
        'old-sess-1',
        'user',
        oldDate.toISOString()
      );
      
      // Insert recent data
      testDb.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
        'new-sess-1',
        'new-sess-1',
        '/new/path'
      );
      
      testDb.prepare('INSERT INTO messages (id, sessionId, type, timestamp) VALUES (?, ?, ?, ?)').run(
        'new-msg-1',
        'new-sess-1',
        'user',
        new Date().toISOString()
      );
      
      // Run retention cleanup
      const retentionService = new RetentionService(testDb);
      const stats = await retentionService.runCleanup(30); // Keep only last 30 days
      
      expect(stats.messagesDeleted).toBeGreaterThan(0);
      
      // Verify old data was deleted
      const oldMessageCount = testDb.prepare('SELECT COUNT(*) as count FROM messages WHERE id = ?').get('old-msg-1') as any;
      expect(oldMessageCount.count).toBe(0);
      
      // Verify new data was kept
      const newMessageCount = testDb.prepare('SELECT COUNT(*) as count FROM messages WHERE id = ?').get('new-msg-1') as any;
      expect(newMessageCount.count).toBe(1);
    });
    
    test('should get retention statistics', async () => {
      const retentionService = new RetentionService(testDb);
      const stats = await retentionService.getRetentionStats(30);
      
      expect(stats).toHaveProperty('cutoffDate');
      expect(stats).toHaveProperty('messagesToDelete');
      expect(stats).toHaveProperty('sessionsToDelete');
      expect(stats).toHaveProperty('estimatedSpaceMB');
    });
  });
  
  describe('Backup Service', () => {
    test('should create and restore backups', async () => {
      // Insert test data
      testDb.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
        'backup-sess-1',
        'backup-sess-1',
        '/backup/path'
      );
      
      testDb.prepare('INSERT INTO messages (id, sessionId, type, timestamp, userText) VALUES (?, ?, ?, ?, ?)').run(
        'backup-msg-1',
        'backup-sess-1',
        'user',
        new Date().toISOString(),
        'Backup test message'
      );
      
      // Create backup
      const backupService = new BackupService(testDb);
      const backupPath = join(TEST_BACKUP_PATH, 'test-backup.db');
      const backupInfo = await backupService.createBackup(backupPath);
      
      expect(backupInfo.success).toBe(true);
      expect(backupInfo.size).toBeGreaterThan(0);
      
      // Delete data
      testDb.prepare('DELETE FROM messages').run();
      testDb.prepare('DELETE FROM sessions').run();
      
      // Verify data is gone
      const countBefore = testDb.prepare('SELECT COUNT(*) as count FROM messages').get() as any;
      expect(countBefore.count).toBe(0);
      
      // Restore backup
      await backupService.restoreBackup(backupPath, TEST_DB_PATH);
      
      // Reinitialize connection after restore
      testDb = initializeDatabase();
      
      // Verify data is restored
      const countAfter = testDb.prepare('SELECT COUNT(*) as count FROM messages WHERE id = ?').get('backup-msg-1') as any;
      expect(countAfter.count).toBe(1);
      
      const restoredMessage = testDb.prepare('SELECT userText FROM messages WHERE id = ?').get('backup-msg-1') as any;
      expect(restoredMessage.userText).toBe('Backup test message');
    });
    
    test('should verify backup integrity', async () => {
      const backupService = new BackupService(testDb);
      const backupPath = join(TEST_BACKUP_PATH, 'integrity-test.db');
      
      await backupService.createBackup(backupPath);
      const isValid = await backupService.verifyBackup(backupPath);
      
      expect(isValid).toBe(true);
    });
  });
  
  describe('Connection Pool Stress Test', () => {
    test('should handle concurrent connections', async () => {
      const pool = new DatabasePool({
        databasePath: TEST_DB_PATH,
        minConnections: 2,
        maxConnections: 5,
        idleTimeoutMs: 5000
      });
      
      // Simulate concurrent operations
      const operations = Array(10).fill(null).map(async (_, i) => {
        const conn = await pool.acquire();
        
        // Perform some database operations
        const result = conn.db.prepare('SELECT ? as value').get(i) as any;
        expect(result.value).toBe(i);
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        pool.release(conn);
      });
      
      await Promise.all(operations);
      
      const stats = pool.getStats();
      expect(stats.totalAcquired).toBeGreaterThanOrEqual(10);
      expect(stats.totalReleased).toBeGreaterThanOrEqual(10);
      
      pool.close();
    });
  });
});