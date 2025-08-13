/**
 * TypeScript interfaces for mem-sqlite MCP server
 */

export interface QueryResult {
  query: string;
  rowCount: number;
  results: Array<Record<string, any>>;
}

export interface QueryArgs {
  sql: string;
  limit?: number;
}

export interface McpResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}