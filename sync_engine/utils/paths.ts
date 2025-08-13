import { homedir } from 'os';
import { join } from 'path';

/**
 * Get the base path for data storage
 * In production (Docker), use /data mount point
 * In development, use user's home directory
 */
export function getBasePath(): string {
  return process.env.NODE_ENV === 'production' 
    ? '/data'
    : join(homedir(), '.local', 'share', 'memories');
}

/**
 * Get the Claude projects directory path
 * In production (Docker), use /claude-projects mount point
 * In development, use user's .claude/projects directory
 */
export function getProjectsPath(): string {
  return process.env.NODE_ENV === 'production'
    ? '/claude-projects'
    : join(homedir(), '.claude', 'projects');
}

/**
 * Get the database file path
 */
export function getDatabasePath(): string {
  return join(getBasePath(), 'claude_code.db');
}

/**
 * Get the transaction log file path
 */
export function getTransactionLogPath(): string {
  return join(getBasePath(), 'memories_db_changes.jsonl');
}

/**
 * Get the database watcher log path
 */
export function getDatabaseWatcherLogPath(): string {
  return join(getBasePath(), 'memories_db_changes.jsonl');
}