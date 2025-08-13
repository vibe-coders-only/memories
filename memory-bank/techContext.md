# Technical Context

## Technology Stack

### Core Runtime
- **Node.js**: Version 20 (LTS)
- **TypeScript**: Full type safety with strict mode
- **Package Manager**: npm with package-lock.json

### Dependencies

#### Production Dependencies
```json
{
  "better-sqlite3": "^12.2.0",    // SQLite database operations
  "chokidar": "^4.0.3",           // File system watching
  "tsx": "^4.0.0",                // TypeScript execution
  "uuid": "^11.1.0",              // ID generation
  "@types/uuid": "^10.0.0"        // UUID type definitions
}
```

#### Development Dependencies
```json
{
  "@types/better-sqlite3": "^7.6.13",  // SQLite type definitions
  "@types/node": "^24.1.0",            // Node.js type definitions  
  "vitest": "^3.2.4"                   // Testing framework
}
```

### Database Technology

#### SQLite Configuration
- **Engine**: better-sqlite3 (synchronous, high-performance)
- **Journal Mode**: WAL (Write-Ahead Logging)
- **Foreign Keys**: Enabled for referential integrity
- **Busy Timeout**: 10 seconds for concurrent access

#### Database Schema
```sql
-- Core tables
sessions (id, sessionId, sessionPath, created)
messages (id, sessionId, type, timestamp, userText, assistantText, ...)
tool_uses (id, messageId, toolId, toolName, parameters)  
tool_use_results (id, toolUseId, messageId, output, error)
attachments (id, messageId, type, text, url, mimeType)
env_info (id, messageId, workingDirectory, platform, osVersion)

-- Indexes for performance
idx_messages_sessionId, idx_messages_timestamp, idx_messages_type
idx_tool_uses_messageId, idx_attachments_messageId
```

## Architecture Patterns

### File System Integration
- **Watcher Pattern**: Chokidar monitors `~/.claude/projects/**/*.jsonl`
- **Event-Driven**: React to file system changes (add, change, unlink)
- **Debouncing**: awaitWriteFinish prevents partial reads

### Data Transformation Pipeline
```
JSONL File → Line Parser → Message Validator → Type Transform → Database Insert
```

### Path Resolution Strategy
```typescript
const getBasePath = () => {
  // Container detection via environment variable
  return process.env.NODE_ENV === 'production' ? '/home/user' : homedir();
};
```

## Docker Architecture

### Container Strategy
- **Base Image**: `node:20-alpine` (minimal Linux)
- **Working Directory**: `/app`
- **Volume Mounts**: 
  - Host `~/.claude/projects` → Container `/home/user/.claude/projects`
  - Host `~/.local/share/memory-sqlite` → Container `/home/user/.local/share/memory-sqlite`

### Multi-Service Setup
```yaml
services:
  memory-sqlite-sync:      # Main sync service
  memory-sqlite-sync-once: # One-time sync (profile: sync-once)  
  terminal-client:         # Testing client (profile: client)
```

## Error Handling Strategy

### File System Errors
- **Missing Files**: Graceful handling of non-existent JSONL files
- **Permission Errors**: Log and continue with available files
- **Malformed JSON**: Skip invalid lines, log errors, continue processing

### Database Errors
- **Schema Migration**: Automatic table creation on first run
- **Constraint Violations**: Handle duplicate inserts gracefully
- **Lock Timeouts**: 10-second busy timeout for concurrent access

### Process Management
- **Graceful Shutdown**: SIGINT/SIGTERM handlers close database connections
- **Error Recovery**: Restart file watchers on crashes
- **Transaction Logging**: All database changes logged to JSONL for audit

## Performance Considerations

### File Processing
- **Streaming**: Process JSONL files line-by-line to handle large files
- **Deduplication**: Check existing message IDs before insertion
- **Batch Operations**: Group related database operations in transactions

### Database Optimization
- **Prepared Statements**: Reuse compiled queries for performance
- **Indexes**: Strategic indexing on common query patterns
- **WAL Mode**: Concurrent reads while writing

### Memory Management
- **Connection Pooling**: Single database connection per process
- **Stream Processing**: Avoid loading entire files into memory
- **Garbage Collection**: Explicit cleanup of large objects

## Development Workflow

### Local Development
```bash
npm run dev     # Run with tsx for hot reload
npm test        # Run vitest test suite
npm run cli     # Direct CLI access
```

### Docker Development  
```bash
docker compose up                    # Main service
docker compose --profile sync-once  # One-time sync
docker compose --profile client     # Testing client
```

### Code Quality
- **TypeScript Strict**: Strict type checking enabled
- **ESM Modules**: Modern ES module syntax
- **Path Safety**: All file paths use `path.join()` for security