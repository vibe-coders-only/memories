/**
 * Integration tests for MCP server functionality
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { searchMessages, searchSessions, getContext, getSummary } from '../../mcp-server/database/queries.js';
import { RateLimiter, QueryComplexityAnalyzer } from '../../mcp-server/middleware/rate-limit.js';
import { initializeDatabase } from '../../sync_engine/execute/schema.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

const TEST_DB_PATH = join(__dirname, '../temp/mcp-test.db');

describe('MCP Server Integration Tests', () => {
  let testDb: Database.Database;
  
  beforeAll(() => {
    // Create test directory and database
    mkdirSync(join(__dirname, '../temp'), { recursive: true });
    process.env.DATABASE_PATH = TEST_DB_PATH;
    testDb = initializeDatabase();
    
    // Insert test data
    insertTestData(testDb);
  });
  
  afterAll(() => {
    if (testDb) testDb.close();
    rmSync(join(__dirname, '../temp'), { recursive: true, force: true });
  });
  
  describe('Query Functions', () => {
    test('should search messages with various filters', () => {
      // Search by text
      const textResults = searchMessages({ query: 'hello' });
      expect(textResults.length).toBeGreaterThan(0);
      expect(textResults[0].userText).toContain('hello');
      
      // Search by session
      const sessionResults = searchMessages({ sessionId: 'test-session-1' });
      expect(sessionResults.length).toBeGreaterThan(0);
      expect(sessionResults.every(r => r.sessionId === 'test-session-1')).toBe(true);
      
      // Search by type
      const typeResults = searchMessages({ type: 'assistant' });
      expect(typeResults.every(r => r.type === 'assistant')).toBe(true);
      
      // Search with date range
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const dateResults = searchMessages({ startDate: startDate.toISOString() });
      expect(dateResults.length).toBeGreaterThan(0);
      
      // Search with limit
      const limitResults = searchMessages({ limit: 5 });
      expect(limitResults.length).toBeLessThanOrEqual(5);
    });
    
    test('should search sessions', () => {
      // Search all sessions
      const allSessions = searchSessions({});
      expect(allSessions.length).toBeGreaterThan(0);
      
      // Search by path
      const pathResults = searchSessions({ sessionPath: '/test/project1' });
      expect(pathResults.length).toBe(1);
      expect(pathResults[0].sessionPath).toBe('/test/project1');
      
      // Search with message count
      const sessionsWithCount = searchSessions({ includeMessageCount: true });
      expect(sessionsWithCount[0]).toHaveProperty('messageCount');
      expect(sessionsWithCount[0].messageCount).toBeGreaterThan(0);
    });
    
    test('should get context for a message', () => {
      // First get a message ID
      const messages = searchMessages({ limit: 1 });
      const messageId = messages[0].id;
      
      // Get context
      const context = getContext(messageId, 2, 2);
      
      expect(context).toHaveProperty('targetMessage');
      expect(context).toHaveProperty('before');
      expect(context).toHaveProperty('after');
      expect(context).toHaveProperty('sessionInfo');
      expect(context).toHaveProperty('toolUses');
      
      expect(context.before.length).toBeLessThanOrEqual(2);
      expect(context.after.length).toBeLessThanOrEqual(2);
    });
    
    test('should get summary statistics', () => {
      const summary = getSummary();
      
      expect(summary).toHaveProperty('totalSessions');
      expect(summary).toHaveProperty('totalMessages');
      expect(summary).toHaveProperty('messagesByType');
      expect(summary).toHaveProperty('recentSessions');
      expect(summary).toHaveProperty('topProjects');
      
      expect(summary.totalSessions).toBeGreaterThan(0);
      expect(summary.totalMessages).toBeGreaterThan(0);
      expect(summary.messagesByType).toHaveProperty('user');
      expect(summary.messagesByType).toHaveProperty('assistant');
    });
    
    test('should handle SQL injection attempts', () => {
      // Try SQL injection in search
      const injectionAttempts = [
        "'; DROP TABLE messages; --",
        "1' OR '1'='1",
        "admin'--",
        "' UNION SELECT * FROM sessions--"
      ];
      
      for (const attempt of injectionAttempts) {
        // Should not throw and should use parameterized queries
        expect(() => searchMessages({ query: attempt })).not.toThrow();
        
        // Verify tables still exist
        const tableCheck = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();
        expect(tableCheck).toBeDefined();
      }
    });
  });
  
  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      const rateLimiter = new RateLimiter();
      const clientId = 'test-client-1';
      
      // Make requests up to limit
      for (let i = 0; i < 60; i++) {
        const result = await rateLimiter.checkLimit(clientId);
        expect(result.allowed).toBe(true);
      }
      
      // Next request should be rate limited
      const limitedResult = await rateLimiter.checkLimit(clientId);
      expect(limitedResult.allowed).toBe(false);
      expect(limitedResult.retryAfter).toBeGreaterThan(0);
      
      // Check status
      const status = rateLimiter.getStatus(clientId);
      expect(status.limited).toBe(true);
      expect(status.requests).toBeGreaterThanOrEqual(60);
      
      // Reset and verify
      rateLimiter.reset(clientId);
      const resetResult = await rateLimiter.checkLimit(clientId);
      expect(resetResult.allowed).toBe(true);
    });
    
    test('should apply weight-based limiting', async () => {
      const rateLimiter = new RateLimiter();
      const clientId = 'test-client-2';
      
      // Complex query with higher weight
      const complexResult = await rateLimiter.checkLimit(clientId, { weight: 10 });
      expect(complexResult.allowed).toBe(true);
      expect(complexResult.remaining).toBeLessThan(50); // Used more tokens
      
      // Simple queries
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit(clientId, { weight: 1 });
        expect(result.allowed).toBe(true);
      }
    });
  });
  
  describe('Query Complexity Analysis', () => {
    test('should analyze query complexity correctly', () => {
      const simpleQuery = 'SELECT * FROM messages WHERE id = ?';
      const simpleComplexity = QueryComplexityAnalyzer.analyze(simpleQuery);
      expect(simpleComplexity).toBeLessThan(3);
      
      const complexQuery = `
        SELECT m.*, t.*, a.*
        FROM messages m
        LEFT JOIN tool_uses t ON m.id = t.messageId
        LEFT JOIN attachments a ON m.id = a.messageId
        WHERE m.userText LIKE '%search%'
        GROUP BY m.id
        ORDER BY m.timestamp DESC
      `;
      const highComplexity = QueryComplexityAnalyzer.analyze(complexQuery);
      expect(highComplexity).toBeGreaterThan(4);
      
      const subqueryQuery = `
        SELECT * FROM messages 
        WHERE sessionId IN (
          SELECT sessionId FROM sessions 
          WHERE created > (SELECT MIN(created) FROM sessions)
        )
      `;
      const subqueryComplexity = QueryComplexityAnalyzer.analyze(subqueryQuery);
      expect(subqueryComplexity).toBeGreaterThan(3);
    });
    
    test('should determine query restrictions', () => {
      const simpleQuery = 'SELECT * FROM messages LIMIT 10';
      const simpleRestrictions = QueryComplexityAnalyzer.getRestrictions(simpleQuery);
      expect(simpleRestrictions.cacheable).toBe(true);
      expect(simpleRestrictions.maxRows).toBeGreaterThan(500);
      
      const complexQuery = 'SELECT * FROM messages JOIN tool_uses JOIN attachments';
      const complexRestrictions = QueryComplexityAnalyzer.getRestrictions(complexQuery);
      expect(complexRestrictions.cacheable).toBe(false);
      expect(complexRestrictions.maxRows).toBeLessThan(500);
      expect(complexRestrictions.timeout).toBeGreaterThan(10000);
    });
  });
  
  describe('MCP Protocol Handlers', () => {
    test('should handle search_messages tool correctly', async () => {
      const params = {
        query: 'test',
        type: 'user',
        limit: 10
      };
      
      // Simulate MCP tool call
      const results = searchMessages(params);
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(10);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('id');
        expect(results[0]).toHaveProperty('sessionId');
        expect(results[0]).toHaveProperty('type');
        expect(results[0].type).toBe('user');
      }
    });
    
    test('should handle get_context tool correctly', () => {
      const messages = searchMessages({ limit: 1 });
      if (messages.length === 0) return;
      
      const context = getContext(messages[0].id, 5, 5);
      
      // Verify context structure
      expect(context.targetMessage.id).toBe(messages[0].id);
      expect(Array.isArray(context.before)).toBe(true);
      expect(Array.isArray(context.after)).toBe(true);
      expect(context.sessionInfo).toHaveProperty('sessionId');
      
      // Verify ordering
      if (context.before.length > 1) {
        const timestamps = context.before.map(m => new Date(m.timestamp).getTime());
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
        }
      }
    });
    
    test('should handle errors gracefully', () => {
      // Invalid message ID
      expect(() => getContext('non-existent-id', 5, 5)).not.toThrow();
      const emptyContext = getContext('non-existent-id', 5, 5);
      expect(emptyContext.targetMessage).toBeNull();
      
      // Invalid parameters
      expect(() => searchMessages({ limit: -1 })).not.toThrow();
      expect(() => searchMessages({ limit: 10000 })).not.toThrow();
      
      // Invalid date format
      expect(() => searchMessages({ startDate: 'invalid-date' })).not.toThrow();
    });
  });
});

/**
 * Helper function to insert test data
 */
function insertTestData(db: Database.Database) {
  // Insert sessions
  db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
    'test-session-1',
    'test-session-1',
    '/test/project1'
  );
  
  db.prepare('INSERT INTO sessions (id, sessionId, sessionPath) VALUES (?, ?, ?)').run(
    'test-session-2',
    'test-session-2',
    '/test/project2'
  );
  
  // Insert messages
  const now = new Date();
  for (let i = 0; i < 20; i++) {
    const timestamp = new Date(now.getTime() - i * 60000).toISOString(); // 1 minute apart
    
    // User message
    db.prepare(`
      INSERT INTO messages (id, sessionId, type, timestamp, userText, userType)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `msg-user-${i}`,
      i % 2 === 0 ? 'test-session-1' : 'test-session-2',
      'user',
      timestamp,
      `Test message ${i}: hello world`,
      'text'
    );
    
    // Assistant response
    db.prepare(`
      INSERT INTO messages (id, sessionId, type, timestamp, assistantText, assistantRole)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `msg-assistant-${i}`,
      i % 2 === 0 ? 'test-session-1' : 'test-session-2',
      'assistant',
      new Date(now.getTime() - i * 60000 + 30000).toISOString(), // 30 seconds after user
      `Response to message ${i}`,
      'assistant'
    );
    
    // Add some tool uses
    if (i % 3 === 0) {
      db.prepare(`
        INSERT INTO tool_uses (id, messageId, toolId, toolName, parameters)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        `tool-${i}`,
        `msg-assistant-${i}`,
        `tool-id-${i}`,
        'test_tool',
        JSON.stringify({ param: i })
      );
      
      db.prepare(`
        INSERT INTO tool_use_results (id, toolUseId, messageId, output)
        VALUES (?, ?, ?, ?)
      `).run(
        `result-${i}`,
        `tool-${i}`,
        `msg-assistant-${i}`,
        `Tool output ${i}`
      );
    }
  }
}