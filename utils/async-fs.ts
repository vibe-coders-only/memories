/**
 * Async file system utilities to prevent blocking the event loop
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

/**
 * Async file operations wrapper with error handling
 */
export class AsyncFileSystem {
  /**
   * Read file asynchronously
   */
  static async readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    try {
      return await fs.readFile(path, encoding);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
      }
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${path}`);
      }
      throw new Error(`Failed to read file ${path}: ${error.message}`);
    }
  }
  
  /**
   * Write file asynchronously
   */
  static async writeFile(
    path: string, 
    data: string | Buffer, 
    options?: { encoding?: BufferEncoding; mode?: number }
  ): Promise<void> {
    try {
      // Ensure directory exists
      await this.ensureDir(dirname(path));
      await fs.writeFile(path, data, options);
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${path}`);
      }
      if (error.code === 'ENOSPC') {
        throw new Error(`No space left on device: ${path}`);
      }
      throw new Error(`Failed to write file ${path}: ${error.message}`);
    }
  }
  
  /**
   * Append to file asynchronously
   */
  static async appendFile(
    path: string,
    data: string | Buffer,
    encoding: BufferEncoding = 'utf8'
  ): Promise<void> {
    try {
      await fs.appendFile(path, data, encoding);
    } catch (error: any) {
      throw new Error(`Failed to append to file ${path}: ${error.message}`);
    }
  }
  
  /**
   * Check if file exists
   */
  static async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Get file stats
   */
  static async stat(path: string) {
    try {
      return await fs.stat(path);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
      }
      throw new Error(`Failed to stat file ${path}: ${error.message}`);
    }
  }
  
  /**
   * Ensure directory exists (create if not)
   */
  static async ensureDir(path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create directory ${path}: ${error.message}`);
      }
    }
  }
  
  /**
   * Read directory asynchronously
   */
  static async readDir(path: string): Promise<string[]> {
    try {
      return await fs.readdir(path);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Directory not found: ${path}`);
      }
      throw new Error(`Failed to read directory ${path}: ${error.message}`);
    }
  }
  
  /**
   * Delete file asynchronously
   */
  static async deleteFile(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return; // File doesn't exist, consider it deleted
      }
      throw new Error(`Failed to delete file ${path}: ${error.message}`);
    }
  }
  
  /**
   * Copy file asynchronously
   */
  static async copyFile(src: string, dest: string): Promise<void> {
    try {
      await this.ensureDir(dirname(dest));
      await fs.copyFile(src, dest);
    } catch (error: any) {
      throw new Error(`Failed to copy ${src} to ${dest}: ${error.message}`);
    }
  }
  
  /**
   * Move/rename file asynchronously
   */
  static async moveFile(src: string, dest: string): Promise<void> {
    try {
      await this.ensureDir(dirname(dest));
      await fs.rename(src, dest);
    } catch (error: any) {
      // If rename fails (cross-device), try copy and delete
      if (error.code === 'EXDEV') {
        await this.copyFile(src, dest);
        await this.deleteFile(src);
      } else {
        throw new Error(`Failed to move ${src} to ${dest}: ${error.message}`);
      }
    }
  }
  
  /**
   * Read JSON file asynchronously
   */
  static async readJSON<T = any>(path: string): Promise<T> {
    const content = await this.readFile(path);
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON in file ${path}: ${error}`);
    }
  }
  
  /**
   * Write JSON file asynchronously
   */
  static async writeJSON(path: string, data: any, pretty: boolean = true): Promise<void> {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await this.writeFile(path, content);
  }
  
  /**
   * Stream copy large files
   */
  static async streamCopy(src: string, dest: string): Promise<void> {
    await this.ensureDir(dirname(dest));
    await pipeline(
      createReadStream(src),
      createWriteStream(dest)
    );
  }
  
  /**
   * Get directory size recursively
   */
  static async getDirectorySize(path: string): Promise<number> {
    let totalSize = 0;
    
    const files = await this.readDir(path);
    
    for (const file of files) {
      const filePath = join(path, file);
      const stats = await this.stat(filePath);
      
      if (stats.isDirectory()) {
        totalSize += await this.getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
    
    return totalSize;
  }
  
  /**
   * Clean directory (delete old files)
   */
  static async cleanDirectory(
    path: string,
    maxAge: number,
    pattern?: RegExp
  ): Promise<number> {
    let deletedCount = 0;
    const cutoff = Date.now() - maxAge;
    
    const files = await this.readDir(path);
    
    for (const file of files) {
      if (pattern && !pattern.test(file)) {
        continue;
      }
      
      const filePath = join(path, file);
      const stats = await this.stat(filePath);
      
      if (stats.mtime.getTime() < cutoff) {
        await this.deleteFile(filePath);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

/**
 * Async file watcher with debouncing
 */
export class AsyncFileWatcher {
  private watchers = new Map<string, fs.FileHandle>();
  private callbacks = new Map<string, Function>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  
  /**
   * Watch a file for changes
   */
  async watch(
    path: string,
    callback: (event: string, filename: string) => void,
    debounce: number = 100
  ): Promise<void> {
    if (this.watchers.has(path)) {
      return; // Already watching
    }
    
    const watcher = fs.watch(path, (event, filename) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(path);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      
      // Set new debounced callback
      const timer = setTimeout(() => {
        callback(event, filename);
        this.debounceTimers.delete(path);
      }, debounce);
      
      this.debounceTimers.set(path, timer);
    });
    
    this.callbacks.set(path, callback);
  }
  
  /**
   * Stop watching a file
   */
  async unwatch(path: string): Promise<void> {
    const watcher = this.watchers.get(path);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(path);
      this.callbacks.delete(path);
      
      const timer = this.debounceTimers.get(path);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(path);
      }
    }
  }
  
  /**
   * Stop all watchers
   */
  async close(): Promise<void> {
    for (const [path] of this.watchers) {
      await this.unwatch(path);
    }
  }
}

/**
 * Batch file operations for efficiency
 */
export class BatchFileOperations {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private batchSize: number;
  private batchDelay: number;
  private timer?: NodeJS.Timeout;
  
  constructor(batchSize: number = 10, batchDelay: number = 100) {
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
  }
  
  /**
   * Add operation to batch queue
   */
  add(operation: () => Promise<void>): void {
    this.queue.push(operation);
    this.scheduleProcess();
  }
  
  /**
   * Schedule batch processing
   */
  private scheduleProcess(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    this.timer = setTimeout(() => {
      this.process();
    }, this.batchDelay);
  }
  
  /**
   * Process batch queue
   */
  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      
      // Process batch in parallel
      await Promise.all(batch.map(op => op().catch(console.error)));
    }
    
    this.processing = false;
  }
  
  /**
   * Wait for all operations to complete
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    await this.process();
    
    // Wait for processing to complete
    while (this.processing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

// Export convenience functions
export const readFileAsync = AsyncFileSystem.readFile;
export const writeFileAsync = AsyncFileSystem.writeFile;
export const existsAsync = AsyncFileSystem.exists;
export const ensureDirAsync = AsyncFileSystem.ensureDir;
export const readJSONAsync = AsyncFileSystem.readJSON;
export const writeJSONAsync = AsyncFileSystem.writeJSON;