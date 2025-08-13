import { readFileSync, watchFile, unwatchFile, statSync, existsSync } from 'fs';
import { EventEmitter } from 'events';
import { getDatabaseWatcherLogPath } from '../utils/paths.js';

export interface DatabaseChange {
  timestamp: string;
  operation: 'insert' | 'update' | 'delete';
  table: string;
  sessionId: string;
  messageId?: string;
  changes: any;
  logId: string;
}

export class DatabaseWatcher extends EventEmitter {
  private logPath: string;
  private lastPosition: number = 0;
  private watching: boolean = false;
  
  constructor(logPath?: string) {
    super();
    this.logPath = logPath || getDatabaseWatcherLogPath();
  }
  
  start(): void {
    if (this.watching) {
      console.log('Database watcher already running');
      return;
    }
    
    console.log(`Starting database watcher on: ${this.logPath}`);
    this.watching = true;
    
    // Initialize position to end of file if it exists
    if (existsSync(this.logPath)) {
      const stats = statSync(this.logPath);
      this.lastPosition = stats.size;
      console.log(`DB_WATCHER: Starting at position ${this.lastPosition}`);
    }
    
    // Watch for file changes
    watchFile(this.logPath, { interval: 100 }, (curr, prev) => {
      if (curr.mtime > prev.mtime && curr.size > this.lastPosition) {
        this.processNewEntries();
      }
    });
    
    this.emit('started');
  }
  
  stop(): void {
    if (!this.watching) return;
    
    console.log('Stopping database watcher');
    this.watching = false;
    unwatchFile(this.logPath);
    this.emit('stopped');
  }
  
  private processNewEntries(): void {
    try {
      if (!existsSync(this.logPath)) return;
      
      const content = readFileSync(this.logPath, 'utf8');
      const newContent = content.slice(this.lastPosition);
      this.lastPosition = content.length;
      
      if (!newContent.trim()) return;
      
      const lines = newContent.trim().split('\n');
      console.log(`DB_WATCHER: Processing ${lines.length} new entries`);
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const change: DatabaseChange = JSON.parse(line);
          this.emit('change', change);
          
          // Emit specific events for different types
          this.emit(`${change.operation}_${change.table}`, change);
          
          console.log(`DB_WATCHER: ${change.operation} on ${change.table} for session ${change.sessionId}`);
        } catch (parseError) {
          console.error('Failed to parse database change log entry:', parseError);
        }
      }
    } catch (error) {
      console.error('Database watcher error:', error);
      this.emit('error', error);
    }
  }
  
  // Utility methods for filtering specific changes
  onSessionInsert(callback: (change: DatabaseChange) => void): this {
    this.on('insert_sessions', callback);
    return this;
  }
  
  onMessageInsert(callback: (change: DatabaseChange) => void): this {
    this.on('insert_messages', callback);
    return this;
  }
  
  onBatchOperation(callback: (change: DatabaseChange) => void): this {
    this.on('insert_batch_operation', callback);
    return this;
  }
  
  // Add message update handlers for reactive UI
  onMessageUpdate(callback: (change: DatabaseChange) => void): this {
    this.on('update_messages', callback);
    return this;
  }
  
  // Get current watcher status
  isWatching(): boolean {
    return this.watching;
  }
  
  getLogPath(): string {
    return this.logPath;
  }
  
  // Expose raw change events for bridge integration
  onDatabaseChange(callback: (change: DatabaseChange) => void): this {
    this.on('change', callback);
    return this;
  }
}