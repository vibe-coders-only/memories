import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { getDatabasePath, getBasePath } from '../utils/paths';

export const DB_PATH = getDatabasePath();

export function initializeDatabase(): Database.Database {
  const dbDir = getBasePath();
  mkdirSync(dbDir, { recursive: true });
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000'); // 10 second timeout for busy database
  
  createTables(db);
  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      sessionPath TEXT NOT NULL,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sessionId)
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      type TEXT NOT NULL,
      
      -- Common fields
      timestamp TEXT NOT NULL,
      isSidechain BOOLEAN DEFAULT 0,
      
      -- Summary message fields
      projectName TEXT,
      activeFile TEXT,
      
      -- User message fields
      userText TEXT,
      userType TEXT,
      userAttachments TEXT,
      toolUseResultId TEXT,
      toolUseResultName TEXT,
      
      -- Assistant message fields
      assistantRole TEXT,
      assistantText TEXT,
      assistantModel TEXT,
      
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sessionId) REFERENCES sessions(sessionId) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS tool_uses (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      toolId TEXT NOT NULL,
      toolName TEXT NOT NULL,
      parameters TEXT NOT NULL,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS tool_use_results (
      id TEXT PRIMARY KEY,
      toolUseId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      output TEXT,
      outputMimeType TEXT,
      error TEXT,
      errorType TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(toolUseId) REFERENCES tool_uses(id) ON DELETE CASCADE,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT,
      url TEXT,
      mimeType TEXT,
      title TEXT,
      filePath TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS env_info (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      workingDirectory TEXT,
      isGitRepo BOOLEAN,
      platform TEXT,
      osVersion TEXT,
      todaysDate TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );
    
    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId_timestamp ON messages(sessionId, timestamp);
    
    -- Foreign key indexes for better join performance
    CREATE INDEX IF NOT EXISTS idx_tool_uses_messageId ON tool_uses(messageId);
    CREATE INDEX IF NOT EXISTS idx_tool_uses_toolId ON tool_uses(toolId);
    CREATE INDEX IF NOT EXISTS idx_tool_use_results_toolUseId ON tool_use_results(toolUseId);
    CREATE INDEX IF NOT EXISTS idx_tool_use_results_messageId ON tool_use_results(messageId);
    CREATE INDEX IF NOT EXISTS idx_attachments_messageId ON attachments(messageId);
    CREATE INDEX IF NOT EXISTS idx_env_info_messageId ON env_info(messageId);
    
    -- Composite indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_tool_uses_name_messageId ON tool_uses(toolName, messageId);
    CREATE INDEX IF NOT EXISTS idx_messages_type_timestamp ON messages(type, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created DESC);
  `);
}

export function getDatabase(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 10000'); // 10 second timeout for busy database
  return db;
}
