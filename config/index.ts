/**
 * Centralized configuration management
 * Loads config from environment variables, config files, and defaults
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export interface DatabaseConfig {
  path: string;
  busyTimeout: number;
  connectionPoolSize: number;
  walMode: boolean;
  foreignKeys: boolean;
  cacheSize: number; // KB
  mmapSize: number;  // bytes
}

export interface SyncConfig {
  batchSize: number;
  streamingThreshold: number; // MB
  watcherEnabled: boolean;
  initialSyncOnStartup: boolean;
  pollingInterval: number; // ms
  maxRetries: number;
}

export interface LogConfig {
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
  file?: string;
  console: boolean;
  format: 'json' | 'text';
  maxFileSize: number; // bytes
}

export interface MCPConfig {
  maxQueryLimit: number;
  queryTimeout: number; // ms
  rateLimitPerMinute: number;
  enableMetrics: boolean;
}

export interface RetentionConfig {
  enabled: boolean;
  daysToKeep: number;
  runIntervalHours: number;
  deleteAttachments: boolean;
  compactAfterCleanup: boolean;
}

export interface BackupConfig {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  path: string;
  compress: boolean;
}

export interface HealthConfig {
  enabled: boolean;
  port: number;
  checkIntervalSeconds: number;
  includeMetrics: boolean;
}

export interface AppConfig {
  database: DatabaseConfig;
  sync: SyncConfig;
  log: LogConfig;
  mcp: MCPConfig;
  retention: RetentionConfig;
  backup: BackupConfig;
  health: HealthConfig;
  projectsPath: string;
  lockDir: string;
}

/**
 * Default configuration values
 */
const defaults: AppConfig = {
  database: {
    path: join(homedir(), '.local', 'share', 'memory-sqlite', 'claude_code.db'),
    busyTimeout: 30000,
    connectionPoolSize: 10,
    walMode: true,
    foreignKeys: true,
    cacheSize: 64000, // 64MB
    mmapSize: 256 * 1024 * 1024 // 256MB
  },
  sync: {
    batchSize: 100,
    streamingThreshold: 10, // 10MB
    watcherEnabled: true,
    initialSyncOnStartup: true,
    pollingInterval: 1000,
    maxRetries: 3
  },
  log: {
    level: 'INFO',
    console: true,
    format: 'text',
    maxFileSize: 100 * 1024 * 1024 // 100MB
  },
  mcp: {
    maxQueryLimit: 1000,
    queryTimeout: 30000,
    rateLimitPerMinute: 100,
    enableMetrics: true
  },
  retention: {
    enabled: false,
    daysToKeep: 30,
    runIntervalHours: 24,
    deleteAttachments: false,
    compactAfterCleanup: true
  },
  backup: {
    enabled: false,
    intervalHours: 24,
    retentionDays: 7,
    path: join(homedir(), '.local', 'share', 'memory-sqlite', 'backups'),
    compress: true
  },
  health: {
    enabled: true,
    port: 3001,
    checkIntervalSeconds: 30,
    includeMetrics: true
  },
  projectsPath: join(homedir(), '.claude', 'projects'),
  lockDir: join(homedir(), '.local', 'share', 'memory-sqlite', 'locks')
};

/**
 * Load configuration from JSON file
 */
function loadConfigFile(path: string): Partial<AppConfig> {
  try {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`Failed to load config file ${path}:`, error);
  }
  
  return {};
}

/**
 * Deep merge configuration objects
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
        result[key] = deepMerge(
          result[key] as any || {},
          source[key] as any
        );
      } else {
        result[key] = source[key] as any;
      }
    }
  }
  
  return result;
}

/**
 * Load configuration from environment variables
 */
function loadFromEnv(): Partial<AppConfig> {
  const config: any = {};
  
  // Database config
  if (process.env.DB_PATH) config.database = { ...config.database, path: process.env.DB_PATH };
  if (process.env.DB_TIMEOUT) config.database = { ...config.database, busyTimeout: parseInt(process.env.DB_TIMEOUT) };
  if (process.env.DB_POOL_SIZE) config.database = { ...config.database, connectionPoolSize: parseInt(process.env.DB_POOL_SIZE) };
  
  // Sync config
  if (process.env.SYNC_BATCH_SIZE) config.sync = { ...config.sync, batchSize: parseInt(process.env.SYNC_BATCH_SIZE) };
  if (process.env.SYNC_STREAMING_THRESHOLD) config.sync = { ...config.sync, streamingThreshold: parseInt(process.env.SYNC_STREAMING_THRESHOLD) };
  if (process.env.SYNC_WATCHER_ENABLED) config.sync = { ...config.sync, watcherEnabled: process.env.SYNC_WATCHER_ENABLED === 'true' };
  
  // Log config
  if (process.env.LOG_LEVEL) config.log = { ...config.log, level: process.env.LOG_LEVEL as any };
  if (process.env.LOG_FILE) config.log = { ...config.log, file: process.env.LOG_FILE };
  if (process.env.LOG_CONSOLE) config.log = { ...config.log, console: process.env.LOG_CONSOLE !== 'false' };
  if (process.env.LOG_FORMAT) config.log = { ...config.log, format: process.env.LOG_FORMAT as any };
  
  // MCP config
  if (process.env.MCP_MAX_QUERY_LIMIT) config.mcp = { ...config.mcp, maxQueryLimit: parseInt(process.env.MCP_MAX_QUERY_LIMIT) };
  if (process.env.MCP_RATE_LIMIT) config.mcp = { ...config.mcp, rateLimitPerMinute: parseInt(process.env.MCP_RATE_LIMIT) };
  
  // Retention config
  if (process.env.RETENTION_ENABLED) config.retention = { ...config.retention, enabled: process.env.RETENTION_ENABLED === 'true' };
  if (process.env.RETENTION_DAYS) config.retention = { ...config.retention, daysToKeep: parseInt(process.env.RETENTION_DAYS) };
  
  // Backup config
  if (process.env.BACKUP_ENABLED) config.backup = { ...config.backup, enabled: process.env.BACKUP_ENABLED === 'true' };
  if (process.env.BACKUP_PATH) config.backup = { ...config.backup, path: process.env.BACKUP_PATH };
  if (process.env.BACKUP_INTERVAL_HOURS) config.backup = { ...config.backup, intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS) };
  
  // Health config
  if (process.env.HEALTH_ENABLED) config.health = { ...config.health, enabled: process.env.HEALTH_ENABLED === 'true' };
  if (process.env.HEALTH_PORT) config.health = { ...config.health, port: parseInt(process.env.HEALTH_PORT) };
  
  // Paths
  if (process.env.PROJECTS_PATH) config.projectsPath = process.env.PROJECTS_PATH;
  if (process.env.LOCK_DIR) config.lockDir = process.env.LOCK_DIR;
  
  return config;
}

/**
 * Configuration singleton
 */
class Config {
  private config: AppConfig;
  private configPath?: string;
  
  constructor() {
    this.config = this.load();
  }
  
  /**
   * Load configuration from all sources
   */
  private load(): AppConfig {
    // Start with defaults
    let config = { ...defaults };
    
    // Load from config files (in order of precedence)
    const configPaths = [
      '/etc/mem-sqlite/config.json',
      join(homedir(), '.config', 'mem-sqlite', 'config.json'),
      join(process.cwd(), 'config.json'),
      process.env.CONFIG_FILE
    ].filter(Boolean) as string[];
    
    for (const path of configPaths) {
      const fileConfig = loadConfigFile(path);
      if (Object.keys(fileConfig).length > 0) {
        config = deepMerge(config, fileConfig);
        this.configPath = path;
        console.log(`Loaded config from ${path}`);
        break; // Use first found config file
      }
    }
    
    // Override with environment variables
    const envConfig = loadFromEnv();
    config = deepMerge(config, envConfig);
    
    // Validate configuration
    this.validate(config);
    
    return config;
  }
  
  /**
   * Validate configuration
   */
  private validate(config: AppConfig): void {
    // Validate paths exist or can be created
    const paths = [
      dirname(config.database.path),
      config.lockDir,
      config.backup.path
    ];
    
    for (const path of paths) {
      if (!existsSync(dirname(path))) {
        console.warn(`Directory does not exist and will be created: ${path}`);
      }
    }
    
    // Validate numeric ranges
    if (config.database.busyTimeout < 0 || config.database.busyTimeout > 3600000) {
      throw new Error('Database busyTimeout must be between 0 and 3600000ms');
    }
    
    if (config.database.connectionPoolSize < 1 || config.database.connectionPoolSize > 100) {
      throw new Error('Database connectionPoolSize must be between 1 and 100');
    }
    
    if (config.retention.daysToKeep < 1) {
      throw new Error('Retention daysToKeep must be at least 1');
    }
  }
  
  /**
   * Get the full configuration
   */
  get(): AppConfig {
    return { ...this.config };
  }
  
  /**
   * Get a specific configuration section
   */
  getSection<K extends keyof AppConfig>(section: K): AppConfig[K] {
    return { ...this.config[section] };
  }
  
  /**
   * Update configuration at runtime (not persisted)
   */
  update(updates: Partial<AppConfig>): void {
    this.config = deepMerge(this.config, updates);
    this.validate(this.config);
  }
  
  /**
   * Save current configuration to file
   */
  save(path?: string): void {
    const savePath = path || this.configPath || join(homedir(), '.config', 'mem-sqlite', 'config.json');
    const dir = dirname(savePath);
    
    if (!existsSync(dir)) {
      const { mkdirSync } = require('fs');
      mkdirSync(dir, { recursive: true });
    }
    
    const { writeFileSync } = require('fs');
    writeFileSync(savePath, JSON.stringify(this.config, null, 2));
    console.log(`Configuration saved to ${savePath}`);
  }
  
  /**
   * Get configuration summary for logging
   */
  getSummary(): string {
    return JSON.stringify({
      database: {
        path: this.config.database.path,
        poolSize: this.config.database.connectionPoolSize
      },
      sync: {
        batchSize: this.config.sync.batchSize,
        watcherEnabled: this.config.sync.watcherEnabled
      },
      log: {
        level: this.config.log.level,
        format: this.config.log.format
      },
      retention: {
        enabled: this.config.retention.enabled,
        daysToKeep: this.config.retention.daysToKeep
      },
      backup: {
        enabled: this.config.backup.enabled,
        intervalHours: this.config.backup.intervalHours
      }
    }, null, 2);
  }
}

// Export singleton instance
export const config = new Config();

// Export convenience getters
export const getConfig = () => config.get();
export const getDatabaseConfig = () => config.getSection('database');
export const getSyncConfig = () => config.getSection('sync');
export const getLogConfig = () => config.getSection('log');
export const getMCPConfig = () => config.getSection('mcp');
export const getRetentionConfig = () => config.getSection('retention');
export const getBackupConfig = () => config.getSection('backup');
export const getHealthConfig = () => config.getSection('health');