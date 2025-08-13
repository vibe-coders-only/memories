/**
 * Database connection wrapper for MCP server
 * Delegates to centralized database connection manager
 */

import { 
  getDatabase as getCentralizedDatabase,
  closeDatabase as closeCentralizedDatabase,
  isDatabaseAvailable as checkDatabaseAvailable
} from '../../database/connection.js';
import Database from 'better-sqlite3';

/**
 * Get database connection (read-only for MCP server)
 */
export function getDatabase(): Database.Database {
  return getCentralizedDatabase({ readonly: true });
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  closeCentralizedDatabase('readonly');
}

/**
 * Check if database exists and is accessible
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  return checkDatabaseAvailable();
}