#!/usr/bin/env node

/**
 * mem-sqlite MCP Server
 * Provides Claude Code with query access to synchronized conversation database
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOL_SCHEMAS } from './tools/schema.js';
import { handleQueryMemory } from './tools/handlers.js';
import { getDatabasePath } from '../sync_engine/utils/paths.js';
import { startWatching } from '../sync_engine/claude_code/index.js';
import type { FSWatcher } from 'chokidar';

// Track watcher instance for cleanup
let syncWatcher: FSWatcher | null = null;

// Create server instance
const server = new Server(
  {
    name: 'mem-sqlite-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_SCHEMAS,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query_memory':
        return await handleQueryMemory(args);
      
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Tool not found: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log startup info to stderr so it doesn't interfere with MCP protocol
  console.error('mem-sqlite MCP server started');
  console.error(`Database path: ${getDatabasePath()}`);
  
  // Start the sync watcher for real-time updates
  try {
    console.error('Starting sync watcher for real-time updates...');
    syncWatcher = await startWatching();
    console.error('Sync watcher started successfully');
  } catch (error) {
    console.error('Warning: Failed to start sync watcher:', error);
    console.error('MCP server will continue but messages won\'t be synced automatically');
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.error('Shutting down mem-sqlite MCP server...');
  
  // Stop the sync watcher
  if (syncWatcher) {
    console.error('Stopping sync watcher...');
    await syncWatcher.close();
  }
  
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down mem-sqlite MCP server...');
  
  // Stop the sync watcher
  if (syncWatcher) {
    console.error('Stopping sync watcher...');
    await syncWatcher.close();
  }
  
  await server.close();
  process.exit(0);
});

main().catch((error) => {
  console.error('Failed to start mem-sqlite MCP server:', error);
  process.exit(1);
});