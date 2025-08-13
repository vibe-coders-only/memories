# Installing mem-sqlite MCP Server with Claude Code

## Prerequisites

1. Ensure you have Node.js 20+ installed
2. Claude Code desktop app installed
3. Some existing conversation history in `~/.claude/projects/`

## Installation Steps

### 1. Clone and Build the Project

```bash
# Clone the repository (or use your existing installation)
cd ~/mem-sqlite

# Install dependencies
npm install

# Run initial sync to populate the database
npm run cli sync
```

### 2. Configure Claude Code MCP Settings

You need to add the MCP server configuration to Claude Code's settings. The configuration file is located at:

**macOS/Linux**: `~/.config/claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\claude\claude_desktop_config.json`

Edit this file and add the mem-sqlite server to the `mcpServers` section:

```json
{
  "mcpServers": {
    "memory-sqlite": {
      "command": "node",
      "args": ["/home/joshf/mem-sqlite/mcp-server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Important**: Adjust the path `/home/joshf/mem-sqlite/` to match your actual installation directory.

### 3. Alternative: Using npx (if published to npm)

If you publish the package to npm, you can use:

```json
{
  "mcpServers": {
    "memory-sqlite": {
      "command": "npx",
      "args": ["mem-sqlite", "mcp-server"]
    }
  }
}
```

### 4. Restart Claude Code

After updating the configuration:
1. Completely quit Claude Code (not just close the window)
2. Restart Claude Code
3. The MCP server should now be available

## Verifying the Installation

### Check if MCP Server is Connected

In Claude Code, you can verify the server is connected by:

1. Opening a new conversation
2. Asking Claude: "What MCP tools do you have available?"
3. Claude should list the `query_memory` tool

### Test the Integration

Try these queries in Claude Code:

```
"Search my conversation history for discussions about Docker"

"Show me what tools I've used most frequently in the past week"

"Find all conversations where I mentioned Python"
```

Claude will translate these to SQL queries and use the `query_memory` tool.

## Manual Testing

### Start MCP Server Standalone

For debugging, you can run the MCP server manually:

```bash
# Start the MCP server directly
npm run mcp-server

# The server communicates via stdio, so you won't see output unless there's an error
```

### Test with MCP Inspector (Optional)

Install the MCP Inspector for testing:

```bash
npx @modelcontextprotocol/inspector npm run mcp-server
```

This will open a web interface where you can test the `query_memory` tool directly.

## Using Docker (Alternative)

If you prefer Docker deployment:

```bash
# Build and start the sync daemon
docker compose up -d

# The MCP server still needs to be configured in Claude Code
# pointing to the containerized service
```

## Troubleshooting

### Server Not Appearing in Claude Code

1. Check the config file syntax is valid JSON
2. Ensure the path to `mcp-server/index.js` is absolute and correct
3. Check Claude Code logs:
   - macOS: `~/Library/Logs/Claude/`
   - Linux: `~/.local/share/claude/logs/`
   - Windows: `%APPDATA%\claude\logs\`

### Database Not Found

If you get "database not found" errors:

```bash
# Ensure database exists
ls -la ~/.local/share/memory-sqlite/claude_code.db

# If not, run initial sync
npm run cli sync
```

### Permission Errors

Ensure the user running Claude Code has read access to:
- The mem-sqlite installation directory
- `~/.local/share/memory-sqlite/claude_code.db`
- `~/.claude/projects/` (for the sync daemon)

## Available SQL Tables

The `query_memory` tool provides access to these tables:

- `sessions` - Conversation sessions
- `messages` - Individual messages (user, assistant, tool_message)
- `tool_uses` - Tool invocations with parameters
- `tool_use_results` - Tool execution results
- `attachments` - File attachments metadata
- `env_info` - Environment context for each message

## Example Queries

```sql
-- Recent activity
SELECT * FROM messages 
WHERE timestamp > datetime('now', '-7 days')
ORDER BY timestamp DESC;

-- Tool usage stats
SELECT toolName, COUNT(*) as count
FROM tool_uses
GROUP BY toolName
ORDER BY count DESC;

-- Search conversations
SELECT sessionId, userText, assistantText
FROM messages
WHERE userText LIKE '%python%' OR assistantText LIKE '%python%';
```

## Running the Sync Daemon

For real-time synchronization, run the watcher daemon:

```bash
# Start the daemon
npm run cli start

# Check status
npm run cli status

# Stop the daemon
npm run cli stop
```

Or use systemd/launchd for automatic startup (see platform-specific documentation).

## Security Notes

- The MCP server provides **read-only** access to the database
- Only SELECT queries are allowed
- The database contains your conversation history - keep it secure
- Consider encrypting `~/.local/share/memory-sqlite/` if storing sensitive data

## Support

For issues or questions:
- Check the logs in `~/.local/share/memory-sqlite/logs/`
- Review test output: `npm test`
- See the test checklist: `MCP_SERVER_TEST_CHECKLIST.md`