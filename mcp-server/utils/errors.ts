/**
 * Error handling utilities for mem-sqlite MCP server
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Convert generic errors to MCP errors
 */
export function toMcpError(error: unknown, context: string = ''): McpError {
  if (error instanceof McpError) {
    return error;
  }
  
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = context ? `${context}: ${message}` : message;
  
  // Classify error types
  if (message.includes('SQLITE_BUSY') || message.includes('database is locked')) {
    return new McpError(
      ErrorCode.InternalError,
      `Database is busy: ${fullMessage}`
    );
  }
  
  if (message.includes('SQLITE_READONLY') || message.includes('readonly')) {
    return new McpError(
      ErrorCode.InvalidRequest,
      `Database is read-only: ${fullMessage}`
    );
  }
  
  if (message.includes('no such table') || message.includes('no such column')) {
    return new McpError(
      ErrorCode.InvalidParams,
      `Invalid query - table or column not found: ${fullMessage}`
    );
  }
  
  if (message.includes('syntax error')) {
    return new McpError(
      ErrorCode.InvalidParams,
      `SQL syntax error: ${fullMessage}`
    );
  }
  
  // Default to internal error
  return new McpError(
    ErrorCode.InternalError,
    fullMessage
  );
}

/**
 * Log errors with context
 */
export function logError(error: unknown, context: string = ''): void {
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = context ? `${context}: ${message}` : message;
  
  console.error(`[mem-sqlite MCP] ${fullMessage}`);
  
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}