/**
 * Data retention and cleanup service
 * Removes old data based on configurable retention policies
 */

import Database from 'better-sqlite3';
import { getDatabase } from '../database/connection.js';
import { getRetentionConfig } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

const logger = getLogger('retention');

export interface RetentionStats {
  startTime: Date;
  endTime?: Date;
  messagesDeleted: number;
  toolUsesDeleted: number;
  toolResultsDeleted: number;
  attachmentsDeleted: number;
  envInfoDeleted: number;
  sessionsDeleted: number;
  spaceSavedBytes?: number;
  errors: string[];
}

/**
 * Data retention service
 */
export class RetentionService {
  private db: Database.Database;
  private config = getRetentionConfig();
  private isRunning = false;
  private lastRun?: Date;
  private intervalId?: NodeJS.Timeout;
  
  constructor(db?: Database.Database) {
    this.db = db || getDatabase({ readonly: false });
  }
  
  /**
   * Start automatic retention cleanup
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Data retention is disabled');
      return;
    }
    
    logger.info('Starting data retention service', {
      daysToKeep: this.config.daysToKeep,
      intervalHours: this.config.runIntervalHours
    });
    
    // Run immediately
    this.runCleanup().catch(error => {
      logger.error('Initial retention cleanup failed', error);
    });
    
    // Schedule periodic runs
    const intervalMs = this.config.runIntervalHours * 60 * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.runCleanup().catch(error => {
        logger.error('Scheduled retention cleanup failed', error);
      });
    }, intervalMs);
  }
  
  /**
   * Stop automatic retention cleanup
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Data retention service stopped');
    }
  }
  
  /**
   * Run retention cleanup
   */
  async runCleanup(daysToKeep?: number): Promise<RetentionStats> {
    if (this.isRunning) {
      logger.warn('Retention cleanup already in progress, skipping');
      throw new Error('Retention cleanup already in progress');
    }
    
    this.isRunning = true;
    const stats: RetentionStats = {
      startTime: new Date(),
      messagesDeleted: 0,
      toolUsesDeleted: 0,
      toolResultsDeleted: 0,
      attachmentsDeleted: 0,
      envInfoDeleted: 0,
      sessionsDeleted: 0,
      errors: []
    };
    
    const days = daysToKeep ?? this.config.daysToKeep;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    logger.info(`Starting retention cleanup for data older than ${days} days`, {
      cutoffDate: cutoffDate.toISOString()
    });
    
    try {
      // Get initial database size
      const initialSize = this.getDatabaseSize();
      
      // Use transaction for atomic cleanup
      const transaction = this.db.transaction(() => {
        // Delete old messages and cascade to related tables
        const deleteMessages = this.db.prepare(`
          DELETE FROM messages 
          WHERE timestamp < ? 
          AND sessionId IN (
            SELECT sessionId FROM sessions 
            WHERE created < ?
          )
        `);
        
        const messagesResult = deleteMessages.run(
          cutoffDate.toISOString(),
          cutoffDate.toISOString()
        );
        stats.messagesDeleted = messagesResult.changes;
        
        // Count cascaded deletions (for stats)
        // Note: These are handled by ON DELETE CASCADE
        
        // Delete orphaned sessions
        const deleteSessions = this.db.prepare(`
          DELETE FROM sessions 
          WHERE created < ? 
          AND NOT EXISTS (
            SELECT 1 FROM messages WHERE messages.sessionId = sessions.sessionId
          )
        `);
        
        const sessionsResult = deleteSessions.run(cutoffDate.toISOString());
        stats.sessionsDeleted = sessionsResult.changes;
        
        // If configured, delete old attachments separately
        if (this.config.deleteAttachments) {
          const deleteAttachments = this.db.prepare(`
            DELETE FROM attachments 
            WHERE created < ?
          `);
          
          const attachmentsResult = deleteAttachments.run(cutoffDate.toISOString());
          stats.attachmentsDeleted = attachmentsResult.changes;
        }
        
        logger.debug('Retention cleanup transaction complete', {
          messagesDeleted: stats.messagesDeleted,
          sessionsDeleted: stats.sessionsDeleted
        });
      });
      
      // Execute transaction
      transaction();
      
      // Compact database if configured
      if (this.config.compactAfterCleanup && 
          (stats.messagesDeleted > 0 || stats.sessionsDeleted > 0)) {
        logger.info('Compacting database after cleanup');
        this.compactDatabase();
      }
      
      // Calculate space saved
      const finalSize = this.getDatabaseSize();
      stats.spaceSavedBytes = Math.max(0, initialSize - finalSize);
      
      stats.endTime = new Date();
      this.lastRun = stats.endTime;
      
      logger.info('Retention cleanup completed successfully', {
        duration: stats.endTime.getTime() - stats.startTime.getTime(),
        messagesDeleted: stats.messagesDeleted,
        sessionsDeleted: stats.sessionsDeleted,
        spaceSaved: `${(stats.spaceSavedBytes / 1024 / 1024).toFixed(2)} MB`
      });
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      stats.errors.push(errorMsg);
      logger.error('Retention cleanup failed', error);
      throw new DatabaseError(`Retention cleanup failed: ${errorMsg}`, {
        operation: 'retention_cleanup',
        daysToKeep: days
      });
    } finally {
      this.isRunning = false;
    }
    
    return stats;
  }
  
  /**
   * Get statistics about data that would be deleted
   */
  async getRetentionStats(daysToKeep?: number): Promise<{
    cutoffDate: Date;
    messagesToDelete: number;
    sessionsToDelete: number;
    estimatedSpaceMB: number;
  }> {
    const days = daysToKeep ?? this.config.daysToKeep;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    try {
      // Count messages to delete
      const messagesCount = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE timestamp < ?
      `).get(cutoffDate.toISOString()) as { count: number };
      
      // Count sessions to delete
      const sessionsCount = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM sessions 
        WHERE created < ? 
        AND NOT EXISTS (
          SELECT 1 FROM messages 
          WHERE messages.sessionId = sessions.sessionId 
          AND messages.timestamp >= ?
        )
      `).get(cutoffDate.toISOString(), cutoffDate.toISOString()) as { count: number };
      
      // Estimate space (rough calculation)
      const avgMessageSize = 1024; // 1KB average per message
      const avgSessionSize = 256;  // 256 bytes per session
      const estimatedBytes = 
        (messagesCount.count * avgMessageSize) + 
        (sessionsCount.count * avgSessionSize);
      
      return {
        cutoffDate,
        messagesToDelete: messagesCount.count,
        sessionsToDelete: sessionsCount.count,
        estimatedSpaceMB: estimatedBytes / 1024 / 1024
      };
    } catch (error) {
      throw new DatabaseError('Failed to get retention statistics', {
        operation: 'retention_stats',
        daysToKeep: days
      });
    }
  }
  
  /**
   * Compact the database to reclaim space
   */
  private compactDatabase(): void {
    try {
      // VACUUM reclaims space and defragments the database
      this.db.pragma('vacuum');
      
      // Analyze tables for better query planning
      this.db.pragma('analyze');
      
      logger.info('Database compacted successfully');
    } catch (error) {
      logger.error('Failed to compact database', error);
      // Don't throw - compaction failure shouldn't fail the whole operation
    }
  }
  
  /**
   * Get current database file size
   */
  private getDatabaseSize(): number {
    try {
      const { statSync } = require('fs');
      const dbPath = this.db.name;
      const stats = statSync(dbPath);
      return stats.size;
    } catch (error) {
      logger.warn('Failed to get database size', error);
      return 0;
    }
  }
  
  /**
   * Get last run information
   */
  getLastRun(): Date | undefined {
    return this.lastRun;
  }
  
  /**
   * Check if cleanup is currently running
   */
  isCleanupRunning(): boolean {
    return this.isRunning;
  }
}

/**
 * Global retention service instance
 */
let globalRetentionService: RetentionService | null = null;

/**
 * Get or create retention service
 */
export function getRetentionService(): RetentionService {
  if (!globalRetentionService) {
    globalRetentionService = new RetentionService();
  }
  return globalRetentionService;
}

/**
 * CLI command for manual retention cleanup
 */
export async function runRetentionCleanup(daysToKeep?: number): Promise<void> {
  const service = getRetentionService();
  
  try {
    const stats = await service.runCleanup(daysToKeep);
    
    console.log('Retention cleanup completed:');
    console.log(`  Messages deleted: ${stats.messagesDeleted}`);
    console.log(`  Sessions deleted: ${stats.sessionsDeleted}`);
    
    if (stats.spaceSavedBytes) {
      console.log(`  Space saved: ${(stats.spaceSavedBytes / 1024 / 1024).toFixed(2)} MB`);
    }
    
    if (stats.errors.length > 0) {
      console.error('Errors encountered:');
      stats.errors.forEach(error => console.error(`  - ${error}`));
    }
  } catch (error) {
    console.error('Retention cleanup failed:', error);
    process.exit(1);
  }
}

// Clean up on process exit
process.on('SIGINT', () => {
  if (globalRetentionService) {
    globalRetentionService.stop();
  }
});

process.on('SIGTERM', () => {
  if (globalRetentionService) {
    globalRetentionService.stop();
  }
});