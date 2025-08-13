/**
 * Centralized database connection management
 * Provides both read-write and read-only connections with proper pooling
 */

import Database from 'better-sqlite3';
import { getDatabasePath } from '../sync_engine/utils/paths.js';
import { DatabasePool } from '../sync_engine/utils/connection_pool.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

const logger = getLogger('database-connection');

/**
 * Connection options
 */
export interface ConnectionOptions {
  readonly?: boolean;
  timeout?: number;
  verbose?: boolean;
  fileMustExist?: boolean;
}

/**
 * Database connection manager
 */
export class DatabaseConnectionManager {
  private static instance: DatabaseConnectionManager;
  private dbPath: string;
  private readWriteDb?: Database.Database;
  private readOnlyDb?: Database.Database;
  private pool?: DatabasePool;
  private isPooled: boolean = false;
  
  private constructor() {
    this.dbPath = getDatabasePath();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseConnectionManager {
    if (!DatabaseConnectionManager.instance) {
      DatabaseConnectionManager.instance = new DatabaseConnectionManager();
    }
    return DatabaseConnectionManager.instance;
  }
  
  /**
   * Get read-write database connection
   */
  getReadWriteConnection(): Database.Database {
    if (this.isPooled && this.pool) {
      throw new Error('Cannot get direct connection when pooling is enabled. Use pool.acquire() instead.');
    }
    
    if (!this.readWriteDb) {
      this.readWriteDb = this.createConnection({
        readonly: false,
        timeout: 30000,
        fileMustExist: false
      });
      
      logger.info('Read-write database connection established', { path: this.dbPath });
    }
    
    return this.readWriteDb;
  }
  
  /**
   * Get read-only database connection
   */
  getReadOnlyConnection(): Database.Database {
    if (!this.readOnlyDb) {
      this.readOnlyDb = this.createConnection({
        readonly: true,
        timeout: 10000,
        fileMustExist: true
      });
      
      logger.info('Read-only database connection established', { path: this.dbPath });
    }
    
    return this.readOnlyDb;
  }
  
  /**
   * Get or create connection pool
   */
  getPool(): DatabasePool {
    if (!this.pool) {
      this.pool = new DatabasePool({
        databasePath: this.dbPath,
        minConnections: 2,
        maxConnections: 10,
        idleTimeoutMs: 30000,
        acquireTimeoutMs: 5000
      });
      
      this.isPooled = true;
      logger.info('Database connection pool created');
    }
    
    return this.pool;
  }
  
  /**
   * Create a new database connection with options
   */
  private createConnection(options: ConnectionOptions): Database.Database {
    try {
      const db = new Database(this.dbPath, options);
      
      // Configure pragmas
      db.pragma(`busy_timeout = ${options.timeout || 10000}`);
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -64000'); // 64MB cache
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 268435456'); // 256MB memory map
      
      // Enable query optimizer
      db.pragma('automatic_index = ON');
      db.pragma('optimize');
      
      if (options.verbose) {
        db.function('log_query', (sql: string) => {
          logger.debug('SQL Query', { sql });
          return null;
        });
      }
      
      return db;
      
    } catch (error) {
      throw new DatabaseError(`Failed to create database connection: ${error}`, {
        operation: 'connection_create',
        path: this.dbPath,
        options
      });
    }
  }
  
  /**
   * Close specific connection
   */
  closeConnection(type: 'readwrite' | 'readonly' | 'all'): void {
    if (type === 'readwrite' || type === 'all') {
      if (this.readWriteDb) {
        this.readWriteDb.close();
        this.readWriteDb = undefined;
        logger.info('Read-write database connection closed');
      }
    }
    
    if (type === 'readonly' || type === 'all') {
      if (this.readOnlyDb) {
        this.readOnlyDb.close();
        this.readOnlyDb = undefined;
        logger.info('Read-only database connection closed');
      }
    }
    
    if (type === 'all' && this.pool) {
      this.pool.close();
      this.pool = undefined;
      this.isPooled = false;
      logger.info('Database connection pool closed');
    }
  }
  
  /**
   * Check if database is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const db = this.getReadOnlyConnection();
      db.prepare('SELECT 1').get();
      return true;
    } catch (error) {
      logger.error('Database availability check failed', error);
      return false;
    }
  }
  
  /**
   * Get database statistics
   */
  getStats(): {
    path: string;
    connections: {
      readWrite: boolean;
      readOnly: boolean;
      pooled: boolean;
      poolSize?: number;
    };
    pragmas: Record<string, any>;
  } {
    const db = this.readWriteDb || this.readOnlyDb;
    const pragmas = db ? {
      journal_mode: db.pragma('journal_mode', { simple: true }),
      cache_size: db.pragma('cache_size', { simple: true }),
      page_size: db.pragma('page_size', { simple: true }),
      synchronous: db.pragma('synchronous', { simple: true }),
      foreign_keys: db.pragma('foreign_keys', { simple: true })
    } : {};
    
    return {
      path: this.dbPath,
      connections: {
        readWrite: !!this.readWriteDb,
        readOnly: !!this.readOnlyDb,
        pooled: this.isPooled,
        poolSize: this.pool ? this.pool.getStats().activeConnections : undefined
      },
      pragmas
    };
  }
  
  /**
   * Execute a transaction with proper error handling
   */
  executeTransaction<T>(
    operation: (db: Database.Database) => T,
    options: { readonly?: boolean } = {}
  ): T {
    const db = options.readonly 
      ? this.getReadOnlyConnection()
      : this.getReadWriteConnection();
    
    try {
      if (options.readonly) {
        // Read-only operations don't need transactions
        return operation(db);
      }
      
      // Wrap in transaction for write operations
      const transaction = db.transaction(() => operation(db));
      return transaction();
      
    } catch (error) {
      logger.error('Transaction failed', error);
      throw new DatabaseError(`Transaction failed: ${error}`, {
        operation: 'transaction',
        readonly: options.readonly
      });
    }
  }
}

// Export convenience functions for backward compatibility
const manager = DatabaseConnectionManager.getInstance();

export function getDatabase(options: ConnectionOptions = {}): Database.Database {
  if (options.readonly) {
    return manager.getReadOnlyConnection();
  }
  return manager.getReadWriteConnection();
}

export function closeDatabase(type: 'readwrite' | 'readonly' | 'all' = 'all'): void {
  manager.closeConnection(type);
}

export function isDatabaseAvailable(): Promise<boolean> {
  return manager.isAvailable();
}

export function getDatabasePool(): DatabasePool {
  return manager.getPool();
}

export function getDatabaseStats() {
  return manager.getStats();
}

// Clean up on process exit
process.on('SIGINT', () => {
  manager.closeConnection('all');
});

process.on('SIGTERM', () => {
  manager.closeConnection('all');
});