/**
 * Database connection pool for better concurrency and performance
 */

import Database from 'better-sqlite3';
import { getDatabasePath } from './paths.js';
import { EventEmitter } from 'events';

export interface PoolOptions {
  databasePath?: string; // Path to database file
  minConnections?: number;          // Minimum connections to maintain
  maxConnections?: number;          // Maximum connections allowed
  idleTimeoutMs?: number;  // Time before idle connections are closed (ms)
  acquireTimeoutMs?: number; // Max time to wait for a connection (ms)
  busyTimeout?: number;  // SQLite busy timeout (ms)
}

interface PooledConnection {
  db: Database.Database;
  id: number;
  inUse: boolean;
  lastUsed: number;
  created: number;
}

/**
 * Connection pool for SQLite databases
 * Note: SQLite has limited concurrency, but pooling helps manage connections
 * and prevents connection exhaustion in high-load scenarios
 */
export class DatabasePool extends EventEmitter {
  private connections: PooledConnection[] = [];
  private waitQueue: Array<(conn: PooledConnection) => void> = [];
  private nextId = 1;
  private closed = false;
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(private options: PoolOptions = {}) {
    super();
    
    // Set defaults (maintain backward compatibility with old names)
    this.options.minConnections = options.minConnections || options.min || 1;
    this.options.maxConnections = options.maxConnections || options.max || 10;
    this.options.idleTimeoutMs = options.idleTimeoutMs || options.idleTimeout || 60000; // 1 minute
    this.options.acquireTimeoutMs = options.acquireTimeoutMs || options.acquireTimeout || 30000; // 30 seconds
    this.options.busyTimeout = options.busyTimeout || 30000; // 30 seconds
    this.options.databasePath = options.databasePath || getDatabasePath();
    
    // Initialize minimum connections
    this.initializePool();
    
    // Start cleanup timer
    this.startCleanupTimer();
  }
  
  /**
   * Initialize the connection pool with minimum connections
   */
  private async initializePool(): Promise<void> {
    for (let i = 0; i < this.options.min!; i++) {
      this.createConnection();
    }
  }
  
  /**
   * Create a new database connection
   */
  private createConnection(): PooledConnection {
    const dbPath = getDatabasePath();
    const db = new Database(dbPath, {
      verbose: process.env.DEBUG_SQL === 'true' ? console.log : undefined
    });
    
    // Configure SQLite for better concurrency
    db.pragma('journal_mode = WAL');        // Write-Ahead Logging for better concurrency
    db.pragma('synchronous = NORMAL');      // Balance between safety and speed
    db.pragma('foreign_keys = ON');         // Enable foreign key constraints
    db.pragma('cache_size = -64000');       // 64MB cache
    db.pragma('mmap_size = 268435456');     // 256MB memory-mapped I/O
    db.pragma(`busy_timeout = ${this.options.busyTimeout}`);
    
    const connection: PooledConnection = {
      db,
      id: this.nextId++,
      inUse: false,
      lastUsed: Date.now(),
      created: Date.now()
    };
    
    this.connections.push(connection);
    this.emit('connection-created', connection.id);
    
    return connection;
  }
  
  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PooledConnection> {
    if (this.closed) {
      throw new Error('Connection pool is closed');
    }
    
    // Try to find an available connection
    let connection = this.connections.find(c => !c.inUse);
    
    if (connection) {
      connection.inUse = true;
      connection.lastUsed = Date.now();
      this.emit('connection-acquired', connection.id);
      return connection;
    }
    
    // Create new connection if under max limit
    if (this.connections.length < this.options.max!) {
      connection = this.createConnection();
      connection.inUse = true;
      connection.lastUsed = Date.now();
      this.emit('connection-acquired', connection.id);
      return connection;
    }
    
    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.indexOf(resolver);
        if (index > -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error('Connection acquire timeout'));
      }, this.options.acquireTimeout!);
      
      const resolver = (conn: PooledConnection) => {
        clearTimeout(timeout);
        conn.inUse = true;
        conn.lastUsed = Date.now();
        this.emit('connection-acquired', conn.id);
        resolve(conn);
      };
      
      this.waitQueue.push(resolver);
    });
  }
  
  /**
   * Release a connection back to the pool
   */
  release(connection: PooledConnection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
    this.emit('connection-released', connection.id);
    
    // Check if anyone is waiting for a connection
    if (this.waitQueue.length > 0) {
      const resolver = this.waitQueue.shift();
      if (resolver) {
        resolver(connection);
      }
    }
  }
  
  /**
   * Execute a query with automatic connection management
   */
  async execute<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    const connection = await this.acquire();
    
    try {
      return operation(connection.db);
    } finally {
      this.release(connection);
    }
  }
  
  /**
   * Execute a transaction with automatic connection management
   */
  async transaction<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    const connection = await this.acquire();
    
    try {
      return connection.db.transaction(() => {
        return operation(connection.db);
      })();
    } finally {
      this.release(connection);
    }
  }
  
  /**
   * Execute an immediate (exclusive) transaction
   */
  async exclusiveTransaction<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    const connection = await this.acquire();
    
    try {
      const transaction = connection.db.transaction(() => {
        return operation(connection.db);
      });
      
      // Use immediate mode for exclusive write lock
      transaction.immediate();
      return transaction();
    } finally {
      this.release(connection);
    }
  }
  
  /**
   * Start the cleanup timer to remove idle connections
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, 10000); // Check every 10 seconds
  }
  
  /**
   * Clean up idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const minConnections = this.options.min!;
    
    // Keep at least minimum connections
    if (this.connections.length <= minConnections) {
      return;
    }
    
    // Find connections to close
    const toClose = this.connections.filter(conn => {
      return !conn.inUse && 
             (now - conn.lastUsed) > this.options.idleTimeout! &&
             this.connections.length > minConnections;
    });
    
    // Close idle connections
    for (const conn of toClose) {
      this.closeConnection(conn);
    }
  }
  
  /**
   * Close a specific connection
   */
  private closeConnection(connection: PooledConnection): void {
    const index = this.connections.indexOf(connection);
    if (index > -1) {
      this.connections.splice(index, 1);
      connection.db.close();
      this.emit('connection-closed', connection.id);
    }
  }
  
  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  } {
    const active = this.connections.filter(c => c.inUse).length;
    
    return {
      total: this.connections.length,
      active,
      idle: this.connections.length - active,
      waiting: this.waitQueue.length
    };
  }
  
  /**
   * Close all connections and shut down the pool
   */
  async close(): Promise<void> {
    this.closed = true;
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // Clear wait queue
    for (const resolver of this.waitQueue) {
      // Reject waiting promises
      resolver(null as any);
    }
    this.waitQueue = [];
    
    // Close all connections
    for (const conn of this.connections) {
      conn.db.close();
    }
    
    this.connections = [];
    this.emit('pool-closed');
  }
}

// Global singleton pool instance
let globalPool: DatabasePool | null = null;

/**
 * Get or create the global database pool
 */
export function getPool(options?: PoolOptions): DatabasePool {
  if (!globalPool) {
    globalPool = new DatabasePool(options || {
      min: 2,
      max: 10,
      idleTimeout: 60000,
      acquireTimeout: 30000,
      busyTimeout: 30000
    });
  }
  
  return globalPool;
}

/**
 * Close the global pool
 */
export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.close();
    globalPool = null;
  }
}

// Clean up on process exit
process.on('exit', () => {
  if (globalPool) {
    globalPool.close();
  }
});

process.on('SIGINT', async () => {
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closePool();
  process.exit(0);
});