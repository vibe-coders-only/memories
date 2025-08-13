/**
 * MCP transport layer setup for mem-sqlite server
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logError } from './utils/errors.js';

/**
 * Create and configure stdio transport
 */
export function createTransport(): StdioServerTransport {
  const transport = new StdioServerTransport();
  
  // Handle transport errors
  transport.onclose = () => {
    console.error('[mem-sqlite MCP] Transport closed');
  };
  
  transport.onerror = (error: Error) => {
    logError(error, 'Transport error');
  };
  
  return transport;
}

/**
 * Handle graceful shutdown
 */
export function setupShutdownHandlers(cleanup: () => Promise<void>): void {
  process.on('SIGINT', async () => {
    console.error('[mem-sqlite MCP] Received SIGINT, shutting down...');
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('[mem-sqlite MCP] Received SIGTERM, shutting down...');
    await cleanup();
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logError(error, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError(reason, 'Unhandled rejection');
    process.exit(1);
  });
}