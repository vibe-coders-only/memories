/**
 * Foreign Key constraint failure handler
 * Handles FK failures by creating missing parent records or retrying operations
 */

import Database from 'better-sqlite3';

export interface FKError {
  table: string;
  column: string;
  value: any;
  parentTable: string;
  parentColumn: string;
}

/**
 * Parse SQLite FK constraint error to extract details
 */
export function parseFKError(error: any): FKError | null {
  if (!error || error.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return null;
  }
  
  // SQLite error messages vary, but typically include table/column info
  const message = error.message || '';
  
  // Try to extract table and column from error message
  // Example: "FOREIGN KEY constraint failed"
  // More detailed: "FOREIGN KEY constraint failed: tool_uses.messageId"
  
  const match = message.match(/FOREIGN KEY constraint failed[:\s]+(\w+)\.(\w+)/);
  if (match) {
    return {
      table: match[1],
      column: match[2],
      value: null, // Would need to extract from context
      parentTable: '', // Would need schema knowledge
      parentColumn: 'id'
    };
  }
  
  // If we can't parse specifics, return generic FK error
  return {
    table: 'unknown',
    column: 'unknown',
    value: null,
    parentTable: 'unknown',
    parentColumn: 'id'
  };
}

/**
 * FK constraint resolution strategies
 */
export class FKResolver {
  constructor(private db: Database.Database) {}
  
  /**
   * Try to resolve FK constraint by creating missing parent record
   */
  async resolveByCreatingParent(
    parentTable: string,
    parentId: string,
    parentData?: any
  ): Promise<boolean> {
    try {
      // Check if parent exists
      const exists = this.db.prepare(
        `SELECT id FROM ${parentTable} WHERE id = ?`
      ).get(parentId);
      
      if (!exists) {
        // Create minimal parent record based on table
        switch (parentTable) {
          case 'sessions':
            this.db.prepare(`
              INSERT OR IGNORE INTO sessions (id, path, timestamp)
              VALUES (?, ?, datetime('now'))
            `).run(parentId, parentData?.path || 'unknown');
            break;
            
          case 'messages':
            this.db.prepare(`
              INSERT OR IGNORE INTO messages (id, sessionId, type, timestamp)
              VALUES (?, ?, ?, datetime('now'))
            `).run(
              parentId, 
              parentData?.sessionId || 'unknown',
              parentData?.type || 'placeholder'
            );
            break;
            
          case 'tool_uses':
            this.db.prepare(`
              INSERT OR IGNORE INTO tool_uses (toolId, messageId, toolName)
              VALUES (?, ?, ?)
            `).run(
              parentId,
              parentData?.messageId || 'unknown',
              parentData?.toolName || 'unknown'
            );
            break;
            
          default:
            console.warn(`Cannot auto-create parent for table: ${parentTable}`);
            return false;
        }
        
        console.log(`Created missing parent record in ${parentTable} with id: ${parentId}`);
        return true;
      }
      
      return true; // Parent already exists
    } catch (error) {
      console.error(`Failed to create parent record:`, error);
      return false;
    }
  }
  
  /**
   * Retry operation with FK resolution
   */
  async retryWithFKResolution<T>(
    operation: () => T,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return operation();
      } catch (error: any) {
        lastError = error;
        
        // Only handle FK constraint errors
        if (error.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          throw error;
        }
        
        console.log(`FK constraint failure (attempt ${attempt}/${maxRetries}):`, error.message);
        
        // Parse error to understand what's missing
        const fkError = parseFKError(error);
        if (!fkError) {
          throw error; // Can't parse, can't fix
        }
        
        // Try to resolve based on common patterns
        if (await this.tryCommonResolutions(fkError)) {
          console.log(`FK constraint resolved, retrying operation...`);
          continue; // Retry the operation
        }
        
        // If we can't resolve, throw
        if (attempt === maxRetries) {
          throw new Error(
            `FK constraint failure after ${maxRetries} attempts: ${error.message}`
          );
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Try common FK resolution patterns
   */
  private async tryCommonResolutions(fkError: FKError): Promise<boolean> {
    // Map common FK relationships
    const fkRelationships: Record<string, { parent: string; column: string }> = {
      'messages.sessionId': { parent: 'sessions', column: 'id' },
      'tool_uses.messageId': { parent: 'messages', column: 'id' },
      'tool_use_results.toolUseId': { parent: 'tool_uses', column: 'toolId' },
      'attachments.messageId': { parent: 'messages', column: 'id' },
      'env_info.messageId': { parent: 'messages', column: 'id' }
    };
    
    const key = `${fkError.table}.${fkError.column}`;
    const relationship = fkRelationships[key];
    
    if (relationship) {
      // We know the parent table, try to create a placeholder
      return await this.resolveByCreatingParent(
        relationship.parent,
        fkError.value || 'unknown'
      );
    }
    
    return false;
  }
}

/**
 * Wrap database operation with FK constraint handling
 */
export function withFKHandling<T>(
  db: Database.Database,
  operation: () => T,
  options: {
    maxRetries?: number;
    createMissingParents?: boolean;
  } = {}
): T {
  const resolver = new FKResolver(db);
  
  if (options.createMissingParents) {
    // Try with automatic parent creation
    return resolver.retryWithFKResolution(operation, options.maxRetries || 3) as T;
  }
  
  // Just retry without creating parents
  let lastError: any;
  const maxRetries = options.maxRetries || 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return operation();
    } catch (error: any) {
      lastError = error;
      
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        console.warn(`FK constraint failure (attempt ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt < maxRetries) {
          // Wait a bit before retry
          const waitMs = attempt * 100;
          const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          sleep(waitMs);
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Batch insert with FK constraint handling
 */
export function batchInsertWithFKHandling(
  db: Database.Database,
  table: string,
  records: any[],
  options: {
    chunkSize?: number;
    onError?: (record: any, error: any) => void;
  } = {}
): { inserted: number; failed: number; errors: any[] } {
  const chunkSize = options.chunkSize || 100;
  const result = {
    inserted: 0,
    failed: 0,
    errors: [] as any[]
  };
  
  const resolver = new FKResolver(db);
  
  // Process in chunks
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    
    // Try to insert chunk in a transaction
    const transaction = db.transaction(() => {
      for (const record of chunk) {
        try {
          // Build dynamic insert based on record keys
          const keys = Object.keys(record);
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map(k => record[k]);
          
          const stmt = db.prepare(`
            INSERT INTO ${table} (${keys.join(', ')})
            VALUES (${placeholders})
          `);
          
          stmt.run(...values);
          result.inserted++;
        } catch (error: any) {
          result.failed++;
          result.errors.push({ record, error });
          
          if (options.onError) {
            options.onError(record, error);
          }
          
          // Don't throw, continue with other records
          console.warn(`Failed to insert record into ${table}:`, error.message);
        }
      }
    });
    
    try {
      transaction();
    } catch (error) {
      console.error(`Transaction failed for chunk:`, error);
      // Transaction failed, all records in chunk failed
      result.failed += chunk.length;
      result.errors.push({ chunk, error });
    }
  }
  
  return result;
}