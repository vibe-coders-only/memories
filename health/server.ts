/**
 * Health check HTTP server for monitoring
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { getDatabase, getDatabaseStats } from '../database/connection.js';
import { getDatabasePath } from '../sync_engine/utils/paths.js';
import { statSync } from 'fs';
import { getLockStats } from '../sync_engine/utils/database_lock.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: {
      connected: boolean;
      path: string;
      sizeBytes?: number;
      error?: string;
    };
    fileWatcher: {
      active: boolean;
      watchedPaths?: number;
    };
    locks: {
      activeLocks: number;
      isWriteLocked: boolean;
    };
    diskSpace: {
      available: boolean;
      path: string;
      freeBytes?: number;
      usedPercent?: number;
      error?: string;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      external: number;
    };
  };
  uptime: number;
  version: string;
}

/**
 * Check database health
 */
async function checkDatabase(): Promise<HealthCheckResult['checks']['database']> {
  try {
    const dbPath = getDatabasePath();
    const db = getDatabase();
    
    // Test query
    const result = db.prepare('SELECT COUNT(*) as count FROM sqlite_master').get() as any;
    
    // Get file size
    const stats = statSync(dbPath);
    
    db.close();
    
    return {
      connected: true,
      path: dbPath,
      sizeBytes: stats.size
    };
  } catch (error) {
    return {
      connected: false,
      path: getDatabasePath(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check disk space
 */
async function checkDiskSpace(): Promise<HealthCheckResult['checks']['diskSpace']> {
  try {
    // Use df command for disk space check (works in Docker)
    const { execSync } = await import('child_process');
    const dbPath = getDatabasePath();
    const dfOutput = execSync(`df -B1 "${dbPath}" | tail -1`).toString();
    const parts = dfOutput.trim().split(/\s+/);
    
    const totalBytes = parseInt(parts[1]);
    const usedBytes = parseInt(parts[2]);
    const availBytes = parseInt(parts[3]);
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);
    
    return {
      available: availBytes > 100 * 1024 * 1024, // At least 100MB free
      path: dbPath,
      freeBytes: availBytes,
      usedPercent
    };
  } catch (error) {
    return {
      available: false,
      path: getDatabasePath(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get health check status
 */
export async function getHealthStatus(watcherActive: boolean = false): Promise<HealthCheckResult> {
  const [database, diskSpace] = await Promise.all([
    checkDatabase(),
    checkDiskSpace()
  ]);
  
  const locks = getLockStats();
  const memUsage = process.memoryUsage();
  
  // Determine overall status
  let status: HealthCheckResult['status'] = 'healthy';
  
  if (!database.connected) {
    status = 'unhealthy';
  } else if (!diskSpace.available || locks.activeLocks > 10) {
    status = 'degraded';
  }
  
  return {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database,
      fileWatcher: {
        active: watcherActive,
        watchedPaths: watcherActive ? 1 : 0
      },
      locks,
      diskSpace,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external
      }
    },
    uptime: process.uptime(),
    version: '1.0.0'
  };
}

/**
 * Start health check HTTP server
 */
export function startHealthServer(
  port: number = 3001,
  getWatcherStatus?: () => boolean
): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    if (req.url === '/health') {
      try {
        const watcherActive = getWatcherStatus ? getWatcherStatus() : false;
        const health = await getHealthStatus(watcherActive);
        
        const statusCode = health.status === 'healthy' ? 200 : 
                          health.status === 'degraded' ? 200 : 503;
        
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    } else if (req.url === '/metrics') {
      // Prometheus-style metrics endpoint
      try {
        const health = await getHealthStatus(getWatcherStatus ? getWatcherStatus() : false);
        
        const metrics = [
          `# HELP mem_sqlite_up Database connection status`,
          `# TYPE mem_sqlite_up gauge`,
          `mem_sqlite_up ${health.checks.database.connected ? 1 : 0}`,
          '',
          `# HELP mem_sqlite_database_size_bytes Database file size`,
          `# TYPE mem_sqlite_database_size_bytes gauge`,
          `mem_sqlite_database_size_bytes ${health.checks.database.sizeBytes || 0}`,
          '',
          `# HELP mem_sqlite_locks_active Number of active locks`,
          `# TYPE mem_sqlite_locks_active gauge`,
          `mem_sqlite_locks_active ${health.checks.locks.activeLocks}`,
          '',
          `# HELP mem_sqlite_disk_free_bytes Free disk space`,
          `# TYPE mem_sqlite_disk_free_bytes gauge`,
          `mem_sqlite_disk_free_bytes ${health.checks.diskSpace.freeBytes || 0}`,
          '',
          `# HELP mem_sqlite_memory_heap_used_bytes Heap memory used`,
          `# TYPE mem_sqlite_memory_heap_used_bytes gauge`,
          `mem_sqlite_memory_heap_used_bytes ${health.checks.memory.heapUsed}`,
          '',
          `# HELP mem_sqlite_uptime_seconds Process uptime`,
          `# TYPE mem_sqlite_uptime_seconds counter`,
          `mem_sqlite_uptime_seconds ${health.uptime}`,
        ].join('\n');
        
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(metrics);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`# Error generating metrics: ${error}`);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found. Available endpoints: /health, /metrics');
    }
  });
  
  server.listen(port, () => {
    console.log(`Health check server listening on port ${port}`);
    console.log(`  - Health: http://localhost:${port}/health`);
    console.log(`  - Metrics: http://localhost:${port}/metrics`);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    server.close(() => {
      console.log('Health check server closed');
    });
  });
}