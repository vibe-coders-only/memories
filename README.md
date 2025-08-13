# memories

MCP server that enables Claude Code to query its own conversation history.

## Overview

memories synchronizes Claude Code's JSONL conversation logs from `~/.claude/projects/` into a structured SQLite database, exposing query capabilities through the Model Context Protocol.

## Features

- Real-time synchronization of conversation history
- SQL query interface for conversation search and analytics
- Automatic message parsing and tool extraction
- Foreign key relationships for data integrity
- Transaction logging for audit trails

## Installation

### Prerequisites

- Node.js 20+
- Docker (recommended) or npm
- Claude Code with MCP support

### Quick Start

```bash
# Clone repository
git clone https://github.com/vibe-coders-only/memories
cd memories

# Install dependencies
npm install

# Run initial sync
npm run cli sync

# Add MCP server to Claude Code
claude mcp add memories npm run mcp-server
```

## Usage

### Docker (Production)

```bash
# Start daemon
docker compose up -d

# View logs
docker compose logs -f

# Stop daemon
docker compose down
```

### Local Development

```bash
# One-time sync
npm run cli sync

# Start watcher daemon
npm run cli start

# Run tests
npm test
```

### Query Examples

Ask Claude Code natural language questions:
- "Find all messages about React components"
- "Show tool usage statistics for this week"
- "Search for error messages in tool executions"

Or use direct SQL queries through the MCP interface:

```sql
-- Recent messages
SELECT * FROM messages 
WHERE timestamp > datetime('now', '-7 days')
ORDER BY timestamp DESC;

-- Tool usage analytics
SELECT toolName, COUNT(*) as count
FROM tool_uses
GROUP BY toolName;
```

## Database Schema

- `sessions` - Conversation sessions with timestamps
- `messages` - User and assistant messages
- `tool_uses` - Tool invocations with parameters
- `tool_use_results` - Execution results and errors
- `attachments` - File attachment metadata
- `env_info` - Environment context

## Architecture

```
JSONL Files → Watcher → Parser → SQLite → MCP Server → Claude Code
```

### Components

**Sync Engine** (`sync_engine/`)
- Watches for JSONL file changes
- Parses and transforms messages
- Manages database operations

**MCP Server** (`mcp-server/`)
- Handles SQL queries from Claude Code
- Provides read-only database access
- Auto-starts sync watcher on initialization

**CLI** (`cli.ts`)
- Manual sync commands
- Daemon management
- Status monitoring

## Configuration

### File Locations

- Source: `~/.claude/projects/**/*.jsonl`
- Database: `~/.local/share/memories/claude_code.db`
- Logs: `~/.local/share/memories/memories_db_changes.jsonl`

### Environment Variables

- `NODE_ENV` - Set to 'production' for Docker deployment
- `DATABASE_PATH` - Override default database location (optional)

## Development

### Build from Source

```bash
npm run build
npm test
```

### Project Structure

```
memories/
├── mcp-server/      # MCP server implementation
├── sync_engine/     # JSONL sync and parsing
├── database/        # Connection management
├── tests/           # Test suites
└── cli.ts           # CLI interface
```

## Troubleshooting

### Database not syncing
- Ensure Claude Code has created conversation files in `~/.claude/projects/`
- Check file permissions on source and destination directories
- Run `npm run cli sync` for manual synchronization

### MCP server not responding
- Verify installation with `claude mcp list`
- Check logs with `docker compose logs` or console output
- Ensure database exists at `~/.local/share/memories/claude_code.db`

## License

MIT
