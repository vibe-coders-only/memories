/**
 * Database backup service with compression and rotation
 */

import Database from 'better-sqlite3';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { getDatabase } from '../database/connection.js';
import { getBackupConfig } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

const logger = getLogger('backup');

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  compressed: boolean;
  timestamp: Date;
  duration: number;
  success: boolean;
  error?: string;
}

export interface BackupStats {
  totalBackups: number;
  totalSize: number;
  oldestBackup?: Date;
  newestBackup?: Date;
  lastBackup?: BackupInfo;
}

/**
 * Database backup service
 */
export class BackupService {
  private db: Database.Database;
  private config = getBackupConfig();
  private isRunning = false;
  private lastBackup?: BackupInfo;
  private intervalId?: NodeJS.Timeout;
  
  constructor(db?: Database.Database) {
    this.db = db || getDatabase({ readonly: false });
    
    // Ensure backup directory exists
    if (!existsSync(this.config.path)) {
      mkdirSync(this.config.path, { recursive: true });
    }
  }
  
  /**
   * Start automatic backups
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Database backups are disabled');
      return;
    }
    
    logger.info('Starting backup service', {
      intervalHours: this.config.intervalHours,
      retentionDays: this.config.retentionDays,
      compress: this.config.compress
    });
    
    // Run initial backup
    this.createBackup().catch(error => {
      logger.error('Initial backup failed', error);
    });
    
    // Schedule periodic backups
    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.createBackup().catch(error => {
        logger.error('Scheduled backup failed', error);
      });
    }, intervalMs);
  }
  
  /**
   * Stop automatic backups
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Backup service stopped');
    }
  }
  
  /**
   * Create a database backup
   */
  async createBackup(customPath?: string): Promise<BackupInfo> {
    if (this.isRunning) {
      throw new Error('Backup already in progress');
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `claude_code_backup_${timestamp}`;
    const backupFile = customPath || join(
      this.config.path,
      this.config.compress ? `${backupName}.db.gz` : `${backupName}.db`
    );
    
    const info: BackupInfo = {
      filename: basename(backupFile),
      path: backupFile,
      size: 0,
      compressed: this.config.compress,
      timestamp: new Date(),
      duration: 0,
      success: false
    };
    
    try {
      logger.info(`Creating backup: ${backupFile}`);
      
      // Use SQLite's backup API for consistency
      await this.performBackup(backupFile);
      
      // Get file size
      const stats = statSync(backupFile);
      info.size = stats.size;
      info.duration = Date.now() - startTime;
      info.success = true;
      
      this.lastBackup = info;
      
      logger.info('Backup completed successfully', {
        filename: info.filename,
        size: `${(info.size / 1024 / 1024).toFixed(2)} MB`,
        duration: `${info.duration}ms`,
        compressed: info.compressed
      });
      
      // Clean old backups
      await this.cleanOldBackups();
      
    } catch (error) {
      info.error = error instanceof Error ? error.message : String(error);
      info.duration = Date.now() - startTime;
      
      logger.error('Backup failed', error);
      
      // Try to clean up failed backup
      try {
        if (existsSync(backupFile)) {
          unlinkSync(backupFile);
        }
      } catch {}
      
      throw new DatabaseError(`Backup failed: ${info.error}`, {
        operation: 'backup',
        path: backupFile
      });
      
    } finally {
      this.isRunning = false;
    }
    
    return info;
  }
  
  /**
   * Perform the actual backup
   */
  private async performBackup(backupFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create a new database connection for backup
        const backupDb = new Database(backupFile);
        
        // Use SQLite's backup API
        const backup = this.db.backup(backupDb);
        
        // Perform backup with progress tracking
        let progress = 0;
        const interval = setInterval(() => {
          const completed = backup.progress;
          if (completed.remaining === 0) {
            clearInterval(interval);
            backup.close();
            backupDb.close();
            
            // Compress if configured
            if (this.config.compress && !backupFile.endsWith('.gz')) {
              this.compressBackup(backupFile)
                .then(() => resolve())
                .catch(reject);
            } else {
              resolve();
            }
          } else {
            // Step through backup
            backup.step(100);
            
            const newProgress = Math.round(
              ((completed.pageCount - completed.remaining) / completed.pageCount) * 100
            );
            
            if (newProgress > progress) {
              progress = newProgress;
              logger.debug(`Backup progress: ${progress}%`);
            }
          }
        }, 100);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Compress a backup file
   */
  private async compressBackup(backupFile: string): Promise<void> {
    const compressedFile = `${backupFile}.gz`;
    
    try {
      await pipeline(
        createReadStream(backupFile),
        createGzip({ level: 9 }), // Maximum compression
        createWriteStream(compressedFile)
      );
      
      // Remove uncompressed file
      unlinkSync(backupFile);
      
      logger.debug(`Backup compressed: ${compressedFile}`);
    } catch (error) {
      // Try to clean up
      try {
        if (existsSync(compressedFile)) {
          unlinkSync(compressedFile);
        }
      } catch {}
      
      throw error;
    }
  }
  
  /**
   * Restore from backup
   */
  async restoreBackup(backupFile: string, targetDb?: string): Promise<void> {
    if (!existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }
    
    logger.info(`Restoring from backup: ${backupFile}`);
    
    try {
      // Decompress if needed
      let sourceFile = backupFile;
      if (backupFile.endsWith('.gz')) {
        sourceFile = await this.decompressBackup(backupFile);
      }
      
      // Close current database connection
      this.db.close();
      
      // Copy backup to target
      const targetPath = targetDb || this.db.name;
      const { copyFileSync } = require('fs');
      
      // Create backup of current database
      const currentBackup = `${targetPath}.before-restore-${Date.now()}`;
      copyFileSync(targetPath, currentBackup);
      logger.info(`Current database backed up to: ${currentBackup}`);
      
      // Restore from backup
      copyFileSync(sourceFile, targetPath);
      
      // Reopen database
      this.db = new Database(targetPath);
      
      // Clean up temp file if we decompressed
      if (sourceFile !== backupFile) {
        unlinkSync(sourceFile);
      }
      
      logger.info('Database restored successfully');
      
    } catch (error) {
      logger.error('Restore failed', error);
      throw new DatabaseError(`Restore failed: ${error}`, {
        operation: 'restore',
        backupFile
      });
    }
  }
  
  /**
   * Decompress a backup file
   */
  private async decompressBackup(compressedFile: string): Promise<string> {
    const { createGunzip } = await import('zlib');
    const tempFile = compressedFile.replace('.gz', '.tmp');
    
    await pipeline(
      createReadStream(compressedFile),
      createGunzip(),
      createWriteStream(tempFile)
    );
    
    return tempFile;
  }
  
  /**
   * Clean old backups based on retention policy
   */
  private async cleanOldBackups(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    
    let deletedCount = 0;
    
    try {
      const files = readdirSync(this.config.path);
      
      for (const file of files) {
        if (!file.startsWith('claude_code_backup_')) {
          continue;
        }
        
        const filePath = join(this.config.path, file);
        const stats = statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          unlinkSync(filePath);
          deletedCount++;
          logger.debug(`Deleted old backup: ${file}`);
        }
      }
      
      if (deletedCount > 0) {
        logger.info(`Cleaned ${deletedCount} old backup(s)`);
      }
      
    } catch (error) {
      logger.error('Failed to clean old backups', error);
    }
    
    return deletedCount;
  }
  
  /**
   * List all backups
   */
  listBackups(): BackupInfo[] {
    const backups: BackupInfo[] = [];
    
    try {
      const files = readdirSync(this.config.path);
      
      for (const file of files) {
        if (!file.startsWith('claude_code_backup_')) {
          continue;
        }
        
        const filePath = join(this.config.path, file);
        const stats = statSync(filePath);
        
        backups.push({
          filename: file,
          path: filePath,
          size: stats.size,
          compressed: file.endsWith('.gz'),
          timestamp: stats.mtime,
          duration: 0,
          success: true
        });
      }
      
      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
    } catch (error) {
      logger.error('Failed to list backups', error);
    }
    
    return backups;
  }
  
  /**
   * Get backup statistics
   */
  getStats(): BackupStats {
    const backups = this.listBackups();
    
    const stats: BackupStats = {
      totalBackups: backups.length,
      totalSize: backups.reduce((sum, b) => sum + b.size, 0),
      lastBackup: this.lastBackup
    };
    
    if (backups.length > 0) {
      stats.newestBackup = backups[0].timestamp;
      stats.oldestBackup = backups[backups.length - 1].timestamp;
    }
    
    return stats;
  }
  
  /**
   * Verify backup integrity
   */
  async verifyBackup(backupFile: string): Promise<boolean> {
    try {
      // Decompress if needed
      let sourceFile = backupFile;
      if (backupFile.endsWith('.gz')) {
        sourceFile = await this.decompressBackup(backupFile);
      }
      
      // Try to open and query the backup
      const testDb = new Database(sourceFile, { readonly: true });
      
      // Run integrity check
      const result = testDb.pragma('integrity_check');
      testDb.close();
      
      // Clean up temp file
      if (sourceFile !== backupFile) {
        unlinkSync(sourceFile);
      }
      
      return result[0].integrity_check === 'ok';
      
    } catch (error) {
      logger.error(`Backup verification failed for ${backupFile}`, error);
      return false;
    }
  }
}

// Global backup service instance
let globalBackupService: BackupService | null = null;

/**
 * Get or create backup service
 */
export function getBackupService(): BackupService {
  if (!globalBackupService) {
    globalBackupService = new BackupService();
  }
  return globalBackupService;
}

// Clean up on process exit
process.on('SIGINT', () => {
  if (globalBackupService) {
    globalBackupService.stop();
  }
});

process.on('SIGTERM', () => {
  if (globalBackupService) {
    globalBackupService.stop();
  }
});