/**
 * Tool request handlers for mem-sqlite MCP server
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { executeQuery } from '../database/queries.js';
import { isDatabaseAvailable } from '../database/connection.js';
import { QueryArgs, McpResponse } from '../database/types.js';

/**
 * Handle query_memory tool requests
 */
export async function handleQueryMemory(args: unknown): Promise<McpResponse> {
  try {
    // Validate arguments
    if (!args || typeof args !== 'object') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments: expected object'
      );
    }
    
    const { sql, limit } = args as Partial<QueryArgs>;
    
    if (!sql || typeof sql !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments: sql is required and must be a string'
      );
    }
    
    if (limit !== undefined && (typeof limit !== 'number' || limit < 1 || limit > 1000)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments: limit must be a number between 1 and 1000'
      );
    }
    
    // Check database availability
    if (!isDatabaseAvailable()) {
      throw new McpError(
        ErrorCode.InternalError,
        'Database is not available. Make sure the mem-sqlite sync engine is running.'
      );
    }
    
    // Execute query
    const result = executeQuery({ sql, limit });
    
    // Format response
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
    
  } catch (error) {
    // Handle McpError instances
    if (error instanceof McpError) {
      throw error;
    }
    
    // Handle validation and execution errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: true,
            message: errorMessage,
            query: (args as Partial<QueryArgs>)?.sql || 'unknown',
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
}