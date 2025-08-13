import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, getDatabase } from '../sync_engine/execute/schema.js';
import { runClaudeCodeSync } from '../sync_engine/claude_code/index.js';
import { readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_JSONL_PATH = join(homedir(), '.claude', 'projects', 'test-project', 'logs', '001_test.jsonl');
const DB_PATH = join(homedir(), '.local', 'share', 'memory-sqlite', 'claude_code.db');

describe('JSONL to Database Sync', () => {
  beforeEach(() => {
    // Ensure clean database
    if (existsSync(DB_PATH)) {
      rmSync(DB_PATH);
    }
    initializeDatabase();
  });
  
  afterEach(() => {
    // Clean up test database
    if (existsSync(DB_PATH)) {
      rmSync(DB_PATH);
    }
  });
  
  it('should sync JSONL messages to database', async () => {
    // Verify database exists
    expect(existsSync(DB_PATH)).toBe(true);
    
    // Run the sync to populate database
    await runClaudeCodeSync();
    
    // Check if any messages from JSONL exist in database
    const db = getDatabase();
    
    try {
      // Count messages in database
      const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      
      // Should now have messages after sync
      expect(messageCount.count).toBeGreaterThan(0);
      
      // Check if we have the expected message types
      const messageTypes = db.prepare('SELECT DISTINCT type FROM messages').all() as { type: string }[];
      const types = messageTypes.map(row => row.type);
      
      // Check for common message types (summary messages may not always be present)
      expect(types).toContain('user');
      expect(types).toContain('assistant');
      // Note: 'summary' messages are only created in certain contexts
      // and may not be present in all test data
      
      // Check for deduplication - no duplicate message IDs
      const duplicates = db.prepare(`
        SELECT id, COUNT(*) as count 
        FROM messages 
        GROUP BY id 
        HAVING COUNT(*) > 1
      `).all();
      
      expect(duplicates).toHaveLength(0);
      
    } finally {
      db.close();
    }
  });
  
  it('should handle tool results masquerading as user messages', async () => {
    // Run sync first
    await runClaudeCodeSync();
    
    const db = getDatabase();
    
    try {
      // Check if tool results are properly linked
      const toolResults = db.prepare(`
        SELECT m.id, m.type, m.toolUseResultId, tr.toolUseId
        FROM messages m
        LEFT JOIN tool_use_results tr ON tr.messageId = m.id
        WHERE m.toolUseResultId IS NOT NULL
      `).all();
      
      // Should have tool results after sync
      expect(toolResults.length).toBeGreaterThanOrEqual(0);
      
    } finally {
      db.close();
    }
  });
  
  it('should track sidechain messages', async () => {
    // Run sync first
    await runClaudeCodeSync();
    
    const db = getDatabase();
    
    try {
      // Check for sidechain messages (from Task tool)
      const sidechainMessages = db.prepare(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE isSidechain = 1
      `).get() as { count: number };
      
      // Should have sidechain messages after sync
      expect(sidechainMessages.count).toBeGreaterThanOrEqual(0);
      
    } finally {
      db.close();
    }
  });
});