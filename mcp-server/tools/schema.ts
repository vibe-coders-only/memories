/**
 * Tool schema definitions for mem-sqlite MCP server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOL_SCHEMAS: Tool[] = [
  {
    name: 'query_memory',
    description: `Execute SQL SELECT queries against the mem-sqlite conversation database.

**Available Tables:**

**sessions** - Conversation sessions
- id (TEXT PRIMARY KEY)
- sessionId (TEXT) - Original session identifier
- sessionPath (TEXT) - File system path to session
- created (DATETIME) - Session creation timestamp

**messages** - Individual conversation messages  
- id (TEXT PRIMARY KEY) - Message UUID
- sessionId (TEXT) - Foreign key to sessions.sessionId
- type (TEXT) - Message type: 'user', 'assistant', 'system', 'summary', 'tool_message'
- timestamp (TEXT) - Message timestamp
- isSidechain (BOOLEAN) - Whether message is on sidechain
- projectName (TEXT) - Project name from summary messages
- activeFile (TEXT) - Active file from summary messages
- userText (TEXT) - User message content
- userType (TEXT) - User type (e.g., 'external')
- userAttachments (TEXT) - User attachments metadata
- toolUseResultId (TEXT) - Tool result ID reference
- toolUseResultName (TEXT) - Tool result name reference
- assistantRole (TEXT) - Assistant role
- assistantText (TEXT) - Assistant message content
- assistantModel (TEXT) - Model used for assistant response

**tool_uses** - Tool invocations extracted from messages
- id (TEXT PRIMARY KEY) - Original JSONL tool_use.id (e.g., 'toolu_01...')
- messageId (TEXT) - Foreign key to messages.id
- toolId (TEXT) - Tool identifier (same as id)
- toolName (TEXT) - Name of tool used (Read, Write, Bash, etc.)
- parameters (TEXT) - JSON string of tool parameters
- created (DATETIME) - Tool use timestamp

**tool_use_results** - Tool execution results
- id (TEXT PRIMARY KEY) - Generated result ID
- toolUseId (TEXT) - Foreign key to tool_uses.id
- messageId (TEXT) - Foreign key to messages.id
- output (TEXT) - Tool execution output
- outputMimeType (TEXT) - MIME type of output
- error (TEXT) - Error message if tool failed
- errorType (TEXT) - Type of error
- created (DATETIME) - Result timestamp

**attachments** - File attachments
- id (TEXT PRIMARY KEY)
- messageId (TEXT) - Foreign key to messages.id
- type (TEXT) - Attachment type
- text (TEXT) - Text content
- url (TEXT) - URL reference
- mimeType (TEXT) - MIME type
- title (TEXT) - Attachment title
- filePath (TEXT) - File system path

**env_info** - Environment context
- id (TEXT PRIMARY KEY)
- messageId (TEXT) - Foreign key to messages.id
- workingDirectory (TEXT) - Working directory
- isGitRepo (BOOLEAN) - Whether in git repository
- platform (TEXT) - Operating system platform
- osVersion (TEXT) - OS version
- todaysDate (TEXT) - Date when message was created

**Example Queries:**

\`\`\`sql
-- Recent conversation activity
SELECT m.timestamp, m.type, m.userText, m.assistantText 
FROM messages m 
WHERE m.timestamp > datetime('now', '-1 day') 
ORDER BY m.timestamp DESC;

-- Tool usage analytics
SELECT tu.toolName, COUNT(*) as usage_count,
       COUNT(tr.id) as results_count,
       COUNT(CASE WHEN tr.error IS NOT NULL THEN 1 END) as error_count
FROM tool_uses tu
LEFT JOIN tool_use_results tr ON tu.id = tr.toolUseId
GROUP BY tu.toolName
ORDER BY usage_count DESC;

-- Search conversations by content
SELECT m.sessionId, m.timestamp, m.userText, m.assistantText
FROM messages m
WHERE (m.userText LIKE '%search term%' OR m.assistantText LIKE '%search term%')
AND m.type IN ('user', 'assistant')
ORDER BY m.timestamp DESC;

-- Session timeline
SELECT s.sessionPath, COUNT(m.id) as message_count,
       MIN(m.timestamp) as first_message,
       MAX(m.timestamp) as last_message
FROM sessions s
LEFT JOIN messages m ON s.sessionId = m.sessionId
GROUP BY s.id
ORDER BY last_message DESC;

-- Find tool results with errors
SELECT tu.toolName, tr.error, tr.errorType, m.timestamp
FROM tool_use_results tr
JOIN tool_uses tu ON tr.toolUseId = tu.id
JOIN messages m ON tr.messageId = m.id
WHERE tr.error IS NOT NULL
ORDER BY m.timestamp DESC;
\`\`\`

**Performance Notes:**
- Database contains 70k+ messages, 25k+ tool uses, 30k+ tool results
- Use LIMIT clauses for large result sets
- Indexed on: sessionId, timestamp, type, messageId, toolName
- Tool IDs use original JSONL format (toolu_*) for FK integrity`,
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'SQL SELECT query to execute. Only SELECT statements are allowed.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (1-1000, default: 100)',
          minimum: 1,
          maximum: 1000,
          default: 100,
        },
      },
      required: ['sql'],
    },
  },
];