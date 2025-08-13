/**
 * Integration tests for sync engine functionality
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { processJsonlFile } from '../../sync_engine/claude_code/index.js';
import { JSONLStreamProcessor } from '../../sync_engine/utils/jsonl_stream.js';
import { MessageValidator, BatchValidator, MessageSanitizer } from '../../sync_engine/validation/schemas.js';
import { FKResolver } from '../../sync_engine/utils/fk_handler.js';
import { FileLock, DatabaseLockManager } from '../../sync_engine/utils/database_lock.js';
import { initializeDatabase } from '../../sync_engine/execute/schema.js';
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '../temp/sync-test');
const TEST_DB_PATH = join(TEST_DIR, 'test.db');
const TEST_JSONL_PATH = join(TEST_DIR, 'test.jsonl');

describe('Sync Engine Integration Tests', () => {
  let testDb: Database.Database;
  
  beforeAll(() => {
    // Create test directory
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.DATABASE_PATH = TEST_DB_PATH;
    testDb = initializeDatabase();
  });
  
  afterAll(() => {
    if (testDb) testDb.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });
  
  beforeEach(() => {
    // Clear database between tests
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
  
  describe('JSONL Processing', () => {
    test('should process valid JSONL file', async () => {
      // Create test JSONL file
      const testData = [
        {
          type: 'summary',
          id: 'summary-1',
          timestamp: new Date().toISOString(),
          projectName: 'Test Project'
        },
        {
          type: 'user',
          id: 'user-1',
          timestamp: new Date().toISOString(),
          text: 'Hello, can you help me?',
          attachments: []
        },
        {
          type: 'assistant',
          id: 'assistant-1',
          timestamp: new Date().toISOString(),
          text: 'Of course! How can I help you?',
          model: 'claude-3',
          toolUses: [
            {
              toolId: 'tool-1',
              toolName: 'search',
              parameters: { query: 'help' }
            }
          ]
        }
      ];
      
      const jsonlContent = testData.map(d => JSON.stringify(d)).join('\n');
      writeFileSync(TEST_JSONL_PATH, jsonlContent);
      
      // Process the file
      const result = await processJsonlFile(TEST_JSONL_PATH, 'test-session', '/test/path');
      
      expect(result.messagesInserted).toBe(3);
      expect(result.errors.length).toBe(0);
      
      // Verify data in database
      const messageCount = testDb.prepare('SELECT COUNT(*) as count FROM messages').get() as any;
      expect(messageCount.count).toBe(3);
      
      const toolUseCount = testDb.prepare('SELECT COUNT(*) as count FROM tool_uses').get() as any;
      expect(toolUseCount.count).toBe(1);
    });
    
    test('should handle large JSONL files with streaming', async () => {
      // Create large JSONL file (>10MB)
      const largeData = [];
      const messageSize = 1024; // 1KB per message
      const messageCount = 11000; // ~11MB total
      
      for (let i = 0; i < messageCount; i++) {
        largeData.push({
          type: i % 2 === 0 ? 'user' : 'assistant',
          id: `msg-${i}`,
          timestamp: new Date().toISOString(),
          text: 'x'.repeat(messageSize), // Padding to reach size
        });
      }
      
      const largeJsonlPath = join(TEST_DIR, 'large.jsonl');
      const jsonlContent = largeData.map(d => JSON.stringify(d)).join('\n');
      writeFileSync(largeJsonlPath, jsonlContent);
      
      // Process should use streaming
      const startMem = process.memoryUsage().heapUsed;
      const result = await processJsonlFile(largeJsonlPath, 'large-session', '/large/path');
      const endMem = process.memoryUsage().heapUsed;
      
      expect(result.messagesInserted).toBe(messageCount);
      
      // Memory usage should be reasonable (not loading entire file)
      const memIncrease = (endMem - startMem) / 1024 / 1024; // MB
      expect(memIncrease).toBeLessThan(100); // Should use less than 100MB additional
    });
    
    test('should handle malformed JSONL gracefully', async () => {
      const malformedData = [
        '{"type": "user", "id": "1", "timestamp": "2024-01-01", "text": "Valid"}',
        'This is not JSON',
        '{"type": "user", "id": "2"', // Incomplete JSON
        '{"type": "unknown", "id": "3"}', // Unknown type
        '{"type": "user", "id": "4", "timestamp": "2024-01-02", "text": "Another valid"}'
      ];
      
      writeFileSync(TEST_JSONL_PATH, malformedData.join('\n'));
      
      const result = await processJsonlFile(TEST_JSONL_PATH, 'malformed-session', '/malformed/path');
      
      // Should process valid entries and log errors for invalid ones
      expect(result.messagesInserted).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
  
  describe('Message Validation', () => {
    test('should validate messages correctly', () => {
      const validator = new MessageValidator();
      
      // Valid message
      const validMessage = {
        id: 'msg-1',
        type: 'user',
        timestamp: new Date().toISOString(),
        text: 'Hello'
      };
      
      const validResult = validator.validate(validMessage);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors.length).toBe(0);
      
      // Invalid message - missing required fields
      const invalidMessage = {
        type: 'user',
        text: 'Hello'
      };
      
      const invalidResult = validator.validate(invalidMessage);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
      
      // Message with warnings
      const warningMessage = {
        id: 'msg-2',
        type: 'user',
        timestamp: 'not-a-valid-date',
        text: 'Hello',
        isSidechain: 'yes' // Should be boolean
      };
      
      const warningResult = validator.validate(warningMessage);
      expect(warningResult.warnings.length).toBeGreaterThan(0);
    });
    
    test('should sanitize messages', () => {
      const sanitizer = new MessageSanitizer();
      
      // Message with missing/incorrect fields
      const dirtyMessage = {
        type: 'user',
        text: '  Hello  ', // Needs trimming
        timestamp: 1234567890000, // Number instead of string
        isSidechain: 'true', // String instead of boolean
        attachments: 'not-an-array' // Should be array
      };
      
      const cleaned = sanitizer.sanitize(dirtyMessage);
      
      expect(cleaned.id).toBeDefined(); // Should generate ID
      expect(cleaned.text).toBe('Hello'); // Should be trimmed
      expect(typeof cleaned.timestamp).toBe('string'); // Should be ISO string
      expect(cleaned.isSidechain).toBe(true); // Should be boolean
      expect(Array.isArray(cleaned.attachments)).toBe(true); // Should be array
    });
    
    test('should batch validate messages', () => {
      const batchValidator = new BatchValidator();
      
      const messages = [
        { id: '1', type: 'user', timestamp: new Date().toISOString(), text: 'Valid' },
        { type: 'user', text: 'Missing fields' },
        { id: '3', type: 'assistant', timestamp: new Date().toISOString(), text: 'Valid assistant' }
      ];
      
      const result = batchValidator.validateBatch(messages);
      
      expect(result.stats.total).toBe(3);
      expect(result.stats.valid).toBe(2);
      expect(result.stats.invalid).toBe(1);
      expect(result.summary).toContain('66%'); // 2/3 valid
    });
  });
  
  describe('Foreign Key Handling', () => {
    test('should resolve FK constraints automatically', async () => {
      const fkResolver = new FKResolver(testDb);
      
      // Try to insert a message with non-existent session
      const operation = () => {
        testDb.prepare(`
          INSERT INTO messages (id, sessionId, type, timestamp)
          VALUES (?, ?, ?, ?)
        `).run('msg-fk-1', 'non-existent-session', 'user', new Date().toISOString());
      };
      
      // Should fail without resolver
      expect(operation).toThrow();
      
      // Should succeed with resolver (creates missing session)
      const result = await fkResolver.retryWithFKResolution(operation);
      expect(result).toBeDefined();
      
      // Verify session was created
      const session = testDb.prepare('SELECT * FROM sessions WHERE sessionId = ?').get('non-existent-session');
      expect(session).toBeDefined();
      
      // Verify message was inserted
      const message = testDb.prepare('SELECT * FROM messages WHERE id = ?').get('msg-fk-1');
      expect(message).toBeDefined();
    });
    
    test('should handle complex FK chains', async () => {
      const fkResolver = new FKResolver(testDb);
      
      // Try to insert tool result without tool use or message
      const operation = () => {
        testDb.prepare(`
          INSERT INTO tool_use_results (id, toolUseId, messageId, output)
          VALUES (?, ?, ?, ?)
        `).run('result-1', 'tool-use-1', 'msg-chain-1', 'Output');
      };
      
      const result = await fkResolver.retryWithFKResolution(operation, 5);
      expect(result).toBeDefined();
      
      // Verify chain was created
      const toolUse = testDb.prepare('SELECT * FROM tool_uses WHERE id = ?').get('tool-use-1');
      expect(toolUse).toBeDefined();
      
      const message = testDb.prepare('SELECT * FROM messages WHERE id = ?').get('msg-chain-1');
      expect(message).toBeDefined();
    });
  });
  
  describe('Locking Mechanisms', () => {
    test('should handle file-based locking', async () => {
      const lockPath = join(TEST_DIR, 'test.lock');
      const lock1 = new FileLock(lockPath);
      const lock2 = new FileLock(lockPath);
      
      // First lock should succeed
      const acquired1 = await lock1.acquire(1000);
      expect(acquired1).toBe(true);
      
      // Second lock should fail (already locked)
      const acquired2 = await lock2.acquire(100);
      expect(acquired2).toBe(false);
      
      // Release first lock
      lock1.release();
      
      // Now second lock should succeed
      const acquired3 = await lock2.acquire(1000);
      expect(acquired3).toBe(true);
      
      lock2.release();
    });
    
    test('should handle database transaction locking', async () => {
      const lockManager = new DatabaseLockManager(testDb);
      
      // Acquire write lock
      const writeLock = await lockManager.acquireWriteLock('test-resource', 1000);
      expect(writeLock).toBe(true);
      
      // Try to acquire another write lock (should fail)
      const writeLock2 = await lockManager.acquireWriteLock('test-resource', 100);
      expect(writeLock2).toBe(false);
      
      // Read lock should also wait
      const readLock = await lockManager.acquireReadLock('test-resource', 100);
      expect(readLock).toBe(false);
      
      // Release write lock
      lockManager.releaseWriteLock('test-resource');
      
      // Now read lock should succeed
      const readLock2 = await lockManager.acquireReadLock('test-resource', 1000);
      expect(readLock2).toBe(true);
      
      lockManager.releaseReadLock('test-resource');
    });
  });
  
  describe('Streaming Processing', () => {
    test('should stream process JSONL efficiently', async () => {
      const processor = new JSONLStreamProcessor();
      
      // Create test JSONL
      const messages = Array(1000).fill(null).map((_, i) => ({
        id: `stream-${i}`,
        type: i % 2 === 0 ? 'user' : 'assistant',
        timestamp: new Date().toISOString(),
        text: `Message ${i}`
      }));
      
      const streamPath = join(TEST_DIR, 'stream.jsonl');
      writeFileSync(streamPath, messages.map(m => JSON.stringify(m)).join('\n'));
      
      // Process with streaming
      const processed: any[] = [];
      await processor.process(streamPath, async (entry) => {
        processed.push(entry);
      });
      
      expect(processed.length).toBe(1000);
      expect(processed[0].id).toBe('stream-0');
      expect(processed[999].id).toBe('stream-999');
    });
    
    test('should handle backpressure in streaming', async () => {
      const processor = new JSONLStreamProcessor();
      
      // Create test JSONL with large messages
      const largeMessages = Array(100).fill(null).map((_, i) => ({
        id: `backpressure-${i}`,
        type: 'user',
        timestamp: new Date().toISOString(),
        text: 'x'.repeat(10000) // 10KB per message
      }));
      
      const backpressurePath = join(TEST_DIR, 'backpressure.jsonl');
      writeFileSync(backpressurePath, largeMessages.map(m => JSON.stringify(m)).join('\n'));
      
      let processedCount = 0;
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      
      await processor.process(backpressurePath, async (entry) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        
        // Simulate slow processing
        await new Promise(resolve => setTimeout(resolve, 10));
        
        processedCount++;
        currentConcurrent--;
      });
      
      expect(processedCount).toBe(100);
      expect(maxConcurrent).toBeLessThan(20); // Should limit concurrency
    });
  });
  
  describe('Error Recovery', () => {
    test('should recover from database errors', async () => {
      let attemptCount = 0;
      const flakyOperation = () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('SQLITE_BUSY');
        }
        return 'success';
      };
      
      // Use retry mechanism
      const retryOperation = async () => {
        for (let i = 0; i < 5; i++) {
          try {
            return flakyOperation();
          } catch (error: any) {
            if (error.message.includes('SQLITE_BUSY') && i < 4) {
              await new Promise(resolve => setTimeout(resolve, 50));
              continue;
            }
            throw error;
          }
        }
      };
      
      const result = await retryOperation();
      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });
    
    test('should handle partial batch failures', async () => {
      const entries = [
        { id: 'valid-1', sessionId: 'session-1', type: 'user', timestamp: new Date().toISOString(), text: 'Valid' },
        { id: 'invalid-1', sessionId: null, type: 'user', timestamp: new Date().toISOString(), text: 'Invalid' }, // Missing sessionId
        { id: 'valid-2', sessionId: 'session-1', type: 'assistant', timestamp: new Date().toISOString(), text: 'Valid' }
      ];
      
      // Insert session first
      testDb.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
        'session-1', 'session-1', '/test'
      );
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const entry of entries) {
        try {
          testDb.prepare(`
            INSERT INTO messages (id, sessionId, type, timestamp, userText)
            VALUES (?, ?, ?, ?, ?)
          `).run(entry.id, entry.sessionId, entry.type, entry.timestamp, entry.text);
          successCount++;
        } catch (error) {
          errorCount++;
        }
      }
      
      expect(successCount).toBe(2);
      expect(errorCount).toBe(1);
      
      // Verify valid entries were inserted
      const messageCount = testDb.prepare('SELECT COUNT(*) as count FROM messages').get() as any;
      expect(messageCount.count).toBe(2);
    });
  });
});