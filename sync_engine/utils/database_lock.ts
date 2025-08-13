/**
 * Database coordination utilities using file-based locking for cross-container safety.
 * Uses SQLite's built-in locking mechanisms and advisory file locks.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { getDatabasePath } from './paths.js';
import Database from 'better-sqlite3';

// Lock file directory - shared across containers via volume mount
const LOCK_DIR = process.env.LOCK_DIR || join(dirname(getDatabasePath()), 'locks');

// Ensure lock directory exists
if (!existsSync(LOCK_DIR)) {
  mkdirSync(LOCK_DIR, { recursive: true });
}

/**
 * File-based mutex that works across containers and processes
 */
class FileLock {
  private lockPath: string;
  private lockAcquired: boolean = false;
  private pid: number = process.pid;
  private startTime: number = Date.now();
  
  constructor(lockName: string) {
    this.lockPath = join(LOCK_DIR, `${lockName}.lock`);
  }
  
  /**
   * Try to acquire the lock with timeout and stale lock detection
   */
  async acquire(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      // Check for stale lock (older than 5 minutes)
      if (existsSync(this.lockPath)) {
        try {
          const lockData = JSON.parse(readFileSync(this.lockPath, 'utf-8'));
          const lockAge = Date.now() - lockData.timestamp;
          
          // If lock is older than 5 minutes, consider it stale and remove it
          if (lockAge > 300000) {
            console.warn(`Removing stale lock: ${this.lockPath} (age: ${lockAge}ms)`);
            unlinkSync(this.lockPath);
          }
        } catch (error) {
          // Lock file might be corrupted, remove it
          console.warn(`Removing corrupted lock: ${this.lockPath}`);
          try {
            unlinkSync(this.lockPath);
          } catch {}
        }
      }
      
      // Try to create lock file atomically
      try {
        // Use exclusive flag to ensure atomic creation
        writeFileSync(this.lockPath, JSON.stringify({
          pid: this.pid,
          timestamp: Date.now(),
          hostname: process.env.HOSTNAME || 'unknown'
        }), { flag: 'wx' });
        
        this.lockAcquired = true;
        return true;
      } catch (error: any) {
        // Lock exists, wait and retry
        if (error.code === 'EEXIST') {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        throw error;
      }
    }
    
    return false; // Timeout reached
  }
  
  /**
   * Release the lock
   */
  release(): void {
    if (this.lockAcquired) {
      try {
        unlinkSync(this.lockPath);
        this.lockAcquired = false;
      } catch (error) {
        console.warn(`Failed to release lock ${this.lockPath}:`, error);
      }
    }
  }
  
  /**
   * Check if lock exists
   */
  isLocked(): boolean {
    return existsSync(this.lockPath);
  }
}

/**
 * SQLite-aware database operations with proper locking
 */
class DatabaseLockManager {
  private db: Database.Database | null = null;
  
  /**
   * Execute operation with SQLite transaction and proper locking
   */
  async withTransaction<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    const db = this.getDatabase();
    
    // Use SQLite's built-in transaction mechanism which handles locking
    return db.transaction(() => {
      return operation(db);
    })();
  }
  
  /**
   * Execute operation with exclusive write lock
   */
  async withExclusiveLock<T>(
    operation: (db: Database.Database) => T
  ): Promise<T> {
    const db = this.getDatabase();
    
    // Set busy timeout to wait for locks
    db.pragma('busy_timeout = 30000'); // 30 seconds
    
    // Use immediate transaction for exclusive write lock
    const transaction = db.transaction(() => {
      return operation(db);
    });
    
    // Mark as immediate to acquire write lock immediately
    transaction.immediate();
    
    return transaction();
  }
  
  /**
   * Get or create database connection
   */
  private getDatabase(): Database.Database {
    if (!this.db) {
      this.db = new Database(getDatabasePath(), {
        verbose: process.env.DEBUG_SQL === 'true' ? console.log : undefined
      });
      
      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 30000');
    }
    
    return this.db;
  }
  
  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Global instances
const dbLockManager = new DatabaseLockManager();
const globalFileLock = new FileLock('global_write');

/**
 * Acquire an exclusive lock for database write operations.
 * Uses both file-based lock (for cross-container) and SQLite transactions.
 */
export async function withDatabaseWriteLock<T>(
  operation: () => T | Promise<T>
): Promise<T> {
  const lock = new FileLock('database_write');
  const acquired = await lock.acquire();
  
  if (!acquired) {
    throw new Error('Failed to acquire database write lock (timeout)');
  }
  
  try {
    return await operation();
  } finally {
    lock.release();
  }
}

/**
 * Execute database operation with proper SQLite transaction
 */
export async function withDatabaseTransaction<T>(
  operation: (db: Database.Database) => T
): Promise<T> {
  return dbLockManager.withTransaction(operation);
}

/**
 * Execute database operation with exclusive write lock
 */
export async function withExclusiveWrite<T>(
  operation: (db: Database.Database) => T
): Promise<T> {
  return dbLockManager.withExclusiveLock(operation);
}

/**
 * Acquire an exclusive lock for a specific session.
 */
export async function withSessionLock<T>(
  sessionId: string,
  operation: () => T | Promise<T>
): Promise<T> {
  const lock = new FileLock(`session_${sessionId}`);
  const acquired = await lock.acquire();
  
  if (!acquired) {
    throw new Error(`Failed to acquire session lock for ${sessionId} (timeout)`);
  }
  
  try {
    return await operation();
  } finally {
    lock.release();
  }
}

/**
 * Check if database write operations are currently locked.
 */
export function isDatabaseWriteLocked(): boolean {
  const lock = new FileLock('database_write');
  return lock.isLocked();
}

/**
 * Check if a specific session is currently being processed.
 */
export function isSessionLocked(sessionId: string): boolean {
  const lock = new FileLock(`session_${sessionId}`);
  return lock.isLocked();
}

/**
 * Get statistics about current lock usage.
 */
export function getLockStats(): { activeLocks: number; isWriteLocked: boolean } {
  // Count lock files in the lock directory
  let activeLocks = 0;
  try {
    const fs = require('fs');
    const files = fs.readdirSync(LOCK_DIR);
    activeLocks = files.filter((f: string) => f.endsWith('.lock')).length;
  } catch {}
  
  return {
    activeLocks,
    isWriteLocked: isDatabaseWriteLocked()
  };
}

/**
 * Clean up stale locks (older than 5 minutes)
 */
export function cleanupStaleLocks(): number {
  let cleaned = 0;
  try {
    const fs = require('fs');
    const files = fs.readdirSync(LOCK_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.lock')) continue;
      
      const lockPath = join(LOCK_DIR, file);
      try {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        const lockAge = Date.now() - lockData.timestamp;
        
        if (lockAge > 300000) { // 5 minutes
          fs.unlinkSync(lockPath);
          cleaned++;
          console.log(`Cleaned stale lock: ${file} (age: ${Math.round(lockAge/1000)}s)`);
        }
      } catch (error) {
        // Lock file might be corrupted, remove it
        try {
          fs.unlinkSync(lockPath);
          cleaned++;
        } catch {}
      }
    }
  } catch (error) {
    console.error('Error cleaning up stale locks:', error);
  }
  
  return cleaned;
}

// Clean up locks on process exit
process.on('exit', () => {
  dbLockManager.close();
});

process.on('SIGINT', () => {
  dbLockManager.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  dbLockManager.close();
  process.exit(0);
});

// Export for backward compatibility
export class DatabaseMutex {
  async withLock<T>(lockId: string, operation: () => T | Promise<T>): Promise<T> {
    return withDatabaseWriteLock(operation);
  }
}