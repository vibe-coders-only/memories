import Database from 'better-sqlite3';
import { initializeDatabase } from './schema.js';
import { getDatabase } from '../../database/connection.js';
import type { ClaudeCodeMessage, SummaryMessage, UserMessage, AssistantMessage } from '../claude_code/types.js';
import { TransactionLogger } from './transaction_log.js';
import type { ParsedEntry, MessageRecord, ToolUseRecord, ToolResultRecord, AttachmentRecord, EnvInfoRecord } from '../claude_code/transform/index.js';

export interface ExecuteResult {
  messagesInserted: number;
  messagesUpdated: number;
  toolUsesInserted: number;
  toolResultsInserted: number;
  attachmentsInserted: number;
  envInfoInserted: number;
  errors: Error[];
}

export function executeToDatabase(messages: any[], sessionId: string, sessionPath: string): ExecuteResult {
  return retryDatabaseOperation(() => {
    const db = getDatabase({ readonly: false });
    const logger = TransactionLogger.getInstance();
    const result: ExecuteResult = {
      messagesInserted: 0,
      messagesUpdated: 0,
      toolUsesInserted: 0,
      toolResultsInserted: 0,
      attachmentsInserted: 0,
      envInfoInserted: 0,
      errors: []
    };
    
    try {
      // Use a single transaction for the entire batch
      const transaction = db.transaction(() => {
        ensureSession(db, sessionId, sessionPath, logger);
        
        for (const message of messages) {
          try {
            const messageId = getMessageId(message);
            const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(messageId);
            
            if (exists) {
              result.messagesUpdated++;
            } else {
              insertMessage(db, message, sessionId, logger);
              result.messagesInserted++;
            }
          } catch (error) {
            result.errors.push(error as Error);
          }
        }
        
        // Log batch operation summary
        if (result.messagesInserted > 0 || result.messagesUpdated > 0) {
          logger.logBatchOperation(sessionId, 'sync_batch', result.messagesInserted + result.messagesUpdated);
        }
      });
      
      transaction();
      
    } catch (error) {
      result.errors.push(error as Error);
    }
    
    return result;
  });
}

function ensureSession(db: Database.Database, sessionId: string, sessionPath: string, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, sessionId, sessionPath)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(sessionId, sessionId, sessionPath);
  
  if (result.changes > 0) {
    logger.logSessionInsert(sessionId, sessionPath);
  }
}

function getMessageId(message: any): string {
  if (message.uuid) return message.uuid;
  if (message.leafUuid) return message.leafUuid;
  return `${message.sessionId}_${Date.now()}_${Math.random()}`;
}

function insertMessage(db: Database.Database, message: any, sessionId: string, logger: TransactionLogger): void {
  const messageId = getMessageId(message);
  
  const baseParams = {
    id: messageId,
    sessionId,
    type: message.type,
    timestamp: message.timestamp || new Date().toISOString(),
    isSidechain: message.isSidechain ? 1 : 0
  };
  
  let params: any = { ...baseParams };
  
  switch (message.type) {
    case 'summary':
      params.projectName = message.summary;
      break;
      
    case 'user':
      params.userText = message.message?.content || '';
      params.userType = message.userType;
      params.userAttachments = null;
      break;
      
    case 'assistant':
      params.assistantRole = message.message?.role;
      params.assistantText = extractAssistantText(message.message?.content);
      params.assistantModel = message.message?.model;
      break;
  }
  
  const columns = Object.keys(params).join(', ');
  const placeholders = Object.keys(params).map(() => '?').join(', ');
  
  // Convert all values to SQLite-compatible types
  const values = Object.values(params).map(value => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value;
    if (Buffer.isBuffer(value)) return value;
    
    // Convert complex objects to JSON strings
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
  
  db.prepare(`
    INSERT INTO messages (${columns})
    VALUES (${placeholders})
  `).run(...values);
  
  // Log the message insertion
  logger.logMessageInsert(sessionId, messageId, message.type);
}

function extractAssistantText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join(' ');
  }
  return '';
}

function retryDatabaseOperation<T>(operation: () => T, maxRetries: number = 5): T {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if this is a SQLite busy error
      if (error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked')) {
        const delay = Math.min(50 * Math.pow(2, attempt - 1), 1000); // Exponential backoff, max 1s
        console.warn(`Database busy, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        
        // Sleep for the delay period
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait for small delays to avoid async complexity
        }
        
        if (attempt < maxRetries) continue;
      }
      
      // Re-throw non-retry errors immediately
      throw error;
    }
  }
  
  throw lastError!;
}

/**
 * Execute parsed entries to database with proper tool extraction
 */
export function executeParsedEntries(parsedEntries: ParsedEntry[]): ExecuteResult {
  return retryDatabaseOperation(() => {
    const db = getDatabase({ readonly: false });
    const logger = TransactionLogger.getInstance();
    const result: ExecuteResult = {
      messagesInserted: 0,
      messagesUpdated: 0,
      toolUsesInserted: 0,
      toolResultsInserted: 0,
      attachmentsInserted: 0,
      envInfoInserted: 0,
      errors: []
    };
    
    try {
      // Use a single transaction for the entire batch
      const transaction = db.transaction(() => {
        for (const parsed of parsedEntries) {
          try {
            // Report any parsing errors
            if (parsed.errors.length > 0) {
              parsed.errors.forEach(error => {
                result.errors.push(new Error(`Parse error: ${error}`));
              });
            }
            
            // Ensure session exists
            ensureSessionRecord(db, parsed.session, logger);
            
            // Insert message if present OR if we have tools that need to reference it
            const hasToolData = parsed.toolUses.length > 0 || parsed.toolResults.length > 0;
            if (parsed.message || hasToolData) {
              let messageToInsert = parsed.message;
              
              // If we have tool data but no message record, we need to create one
              if (!messageToInsert && hasToolData) {
                // Find the original message ID from the first tool record
                const firstToolId = parsed.toolUses[0]?.messageId || parsed.toolResults[0]?.messageId;
                if (firstToolId) {
                  // Create a minimal message record for tools to reference
                  messageToInsert = {
                    id: firstToolId,
                    sessionId: parsed.session.id,
                    type: 'tool_message',
                    timestamp: new Date().toISOString(),
                    isSidechain: false,
                    projectName: parsed.session.sessionPath || null,
                    activeFile: null,
                    userText: null,
                    userType: null,
                    userAttachments: null,
                    toolUseResultId: null,
                    toolUseResultName: null,
                    assistantRole: null,
                    assistantText: null,
                    assistantModel: null
                  };
                }
              }
              
              if (messageToInsert) {
                const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(messageToInsert.id);
                if (exists) {
                  result.messagesUpdated++;
                } else {
                  insertMessageRecord(db, messageToInsert, logger);
                  result.messagesInserted++;
                }
              }
            }
            
            // Insert tool uses
            for (const toolUse of parsed.toolUses) {
              const exists = db.prepare('SELECT id FROM tool_uses WHERE id = ?').get(toolUse.id);
              if (!exists) {
                insertToolUseRecord(db, toolUse, parsed.session.id, logger);
                result.toolUsesInserted++;
              }
            }
            
            // Insert tool results
            for (const toolResult of parsed.toolResults) {
              const exists = db.prepare('SELECT id FROM tool_use_results WHERE id = ?').get(toolResult.id);
              if (!exists) {
                insertToolResultRecord(db, toolResult, parsed.session.id, logger);
                result.toolResultsInserted++;
              }
            }
            
            // Insert attachments
            for (const attachment of parsed.attachments) {
              const exists = db.prepare('SELECT id FROM attachments WHERE id = ?').get(attachment.id);
              if (!exists) {
                insertAttachmentRecord(db, attachment, logger);
                result.attachmentsInserted++;
              }
            }
            
            // Insert env info
            if (parsed.envInfo) {
              const exists = db.prepare('SELECT id FROM env_info WHERE id = ?').get(parsed.envInfo.id);
              if (!exists) {
                insertEnvInfoRecord(db, parsed.envInfo, logger);
                result.envInfoInserted++;
              }
            }
            
          } catch (error) {
            result.errors.push(error as Error);
          }
        }
        
        // Log batch operation summary
        const totalInserted = result.messagesInserted + result.toolUsesInserted + result.toolResultsInserted;
        if (totalInserted > 0) {
          logger.logBatchOperation('batch', 'parsed_entries', totalInserted);
        }
      });
      
      transaction();
      
    } catch (error) {
      result.errors.push(error as Error);
    }
    
    return result;
  });
}

function ensureSessionRecord(db: Database.Database, session: { id: string; sessionId: string; sessionPath: string }, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, sessionId, sessionPath)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(session.id, session.sessionId, session.sessionPath);
  
  if (result.changes > 0) {
    logger.logSessionInsert(session.sessionId, session.sessionPath);
  }
}

function insertMessageRecord(db: Database.Database, message: MessageRecord, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT INTO messages (
      id, sessionId, type, timestamp, isSidechain,
      projectName, activeFile, userText, userType, userAttachments,
      toolUseResultId, toolUseResultName, assistantRole, assistantText, assistantModel
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    message.id, message.sessionId, message.type, message.timestamp, message.isSidechain ? 1 : 0,
    message.projectName || null, message.activeFile || null, message.userText || null, 
    message.userType || null, message.userAttachments || null,
    message.toolUseResultId || null, message.toolUseResultName || null, 
    message.assistantRole || null, message.assistantText || null, message.assistantModel || null
  );
  
  logger.logMessageInsert(message.sessionId, message.id, message.type);
}

function insertToolUseRecord(db: Database.Database, toolUse: ToolUseRecord, sessionId: string, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT INTO tool_uses (id, messageId, toolId, toolName, parameters)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    toolUse.id, toolUse.messageId, toolUse.toolId || null, 
    toolUse.toolName || null, toolUse.parameters || null
  );
  
  logger.logToolUseInsert(sessionId, toolUse.messageId, toolUse.toolId, toolUse.toolName);
}

function insertToolResultRecord(db: Database.Database, toolResult: ToolResultRecord, sessionId: string, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT INTO tool_use_results (id, toolUseId, messageId, output, outputMimeType, error, errorType)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    toolResult.id || null, 
    toolResult.toolUseId || null, 
    toolResult.messageId || null, 
    toolResult.output || null,
    toolResult.outputMimeType || null, 
    toolResult.error || null, 
    toolResult.errorType || null
  );
  
  logger.logToolResultInsert(sessionId, toolResult.messageId, toolResult.toolUseId);
}

function insertAttachmentRecord(db: Database.Database, attachment: AttachmentRecord, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT INTO attachments (id, messageId, type, text, url, mimeType, title, filePath)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    attachment.id, attachment.messageId, attachment.type || null, attachment.text || null,
    attachment.url || null, attachment.mimeType || null, attachment.title || null, attachment.filePath || null
  );
}

function insertEnvInfoRecord(db: Database.Database, envInfo: EnvInfoRecord, logger: TransactionLogger): void {
  const stmt = db.prepare(`
    INSERT INTO env_info (id, messageId, workingDirectory, isGitRepo, platform, osVersion, todaysDate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    envInfo.id, envInfo.messageId, envInfo.workingDirectory || null, 
    envInfo.isGitRepo ? 1 : 0, envInfo.platform || null, 
    envInfo.osVersion || null, envInfo.todaysDate || null
  );
}

