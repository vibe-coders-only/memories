# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

memories is an MCP server that enables Claude Code to query conversation history. It synchronizes JSONL conversation logs from `~/.claude/projects/` into a structured SQLite database for real-time querying.

## Critical Guidelines

**NEVER modify files in `~/.claude/projects/`** - This directory contains production Claude Code conversation data and is mounted read-only. Any modifications will fail and may corrupt the sync pipeline.

## Common Commands

### Docker Operations (Production)
```bash
# Start sync daemon
docker compose up -d

# View logs  
docker compose logs -f

# One-time sync
docker compose --profile sync-once up memories-sync-once

# Stop daemon
docker compose down
```

### Local Development
```bash
# Run tests
npm test

# Development mode
npm run dev

# CLI commands
npm run cli sync    # One-time sync
npm run cli start   # Start watcher daemon
npm run cli stop    # Stop daemon
npm run cli status  # Check daemon status

# MCP server (for testing)
npm run mcp-server
```

## Architecture

### Core Data Flow
```
Claude Code → JSONL Files → Watcher → Parser → SQLite → MCP Server → Claude Code Queries
```

### Key Components

**Sync Engine** (`sync_engine/`)
- `claude_code/index.ts` - Main orchestration, JSONL parsing, and message transformation
- `execute/database.ts` - Database operations and transaction management
- `execute/schema.ts` - SQLite schema initialization with foreign key constraints

**MCP Server** (`mcp-server/`)
- Exposes `query_memory` tool for SQL queries against synchronized data
- Uses Model Context Protocol for Claude Code integration
- Handles only read operations on the database

**CLI Interface** (`cli.ts`)
- Commands: sync, start, stop, status
- Manages daemon lifecycle and one-time synchronization

### Database Schema

The normalized SQLite schema (`~/.local/share/memories/claude_code.db`):
- `sessions` - Conversation sessions with timestamps
- `messages` - User/assistant messages linked to sessions
- `tool_uses` - Tool invocations with parameters
- `tool_use_results` - Tool execution results and errors
- `attachments` - File attachments metadata
- `env_info` - Environment context per message

Foreign key relationships maintain data integrity across tables.

### File Locations

- **Source Data**: `~/.claude/projects/**/*.jsonl` (read-only mount)
- **Database**: `~/.local/share/memories/claude_code.db`
- **Transaction Log**: `~/.local/share/memories/memories_db_changes.jsonl`
- **Docker Volume**: `/data` inside container

## Development Notes

### TypeScript Configuration
- ES modules (`"type": "module"` in package.json)
- Uses `tsx` for TypeScript execution
- Node.js 20 runtime in Alpine Linux container

### Testing
- Vitest framework for unit tests
- Test files in `tests/` directory
- Run with `npm test`

### Docker Setup
- Non-root user (node:1000) for security
- Read-only mount for Claude Code data
- WAL mode SQLite for performance
- Two profiles: default (daemon) and sync-once

### Error Handling
- Transaction logging for audit trail
- Graceful shutdown handlers for SIGINT/SIGTERM
- Comprehensive error messages in MCP responses

## MCP Integration

The MCP server provides the `query_memory` tool that accepts SQL queries:

```sql
-- Example queries
SELECT * FROM messages WHERE timestamp > datetime('now', '-7 days');
SELECT toolName, COUNT(*) FROM tool_uses GROUP BY toolName;
```

When integrated with Claude Code, this enables natural language queries that are translated to SQL behind the scenes.