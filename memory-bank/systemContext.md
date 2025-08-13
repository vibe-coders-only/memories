# System Context

## Problem Statement

Claude Code generates conversation logs in JSONL (JSON Lines) format stored in `~/.claude/projects/`. These files contain rich conversation data including:
- User messages and attachments
- Assistant responses with tool calls
- Tool execution results
- Session metadata
- Environment information

However, this data is stored as append-only text files, making it difficult to:
- Query historical conversations
- Analyze tool usage patterns  
- Track message relationships
- Perform real-time monitoring
- Build integrations requiring structured data access

## Solution Architecture

memories bridges this gap by:

1. **Watching** Claude Code project directories for JSONL file changes
2. **Parsing** JSONL messages into structured TypeScript objects
3. **Transforming** raw messages into normalized database records
4. **Storing** in SQLite with proper relationships and indexes
5. **Logging** all database changes for audit and downstream consumption

## Use Cases

### Primary Use Cases
- **Conversation Search**: Query messages by content, timestamp, or metadata
- **Tool Analytics**: Analyze which tools are used and how often
- **Session Management**: Track conversation sessions and their progression
- **Real-time Monitoring**: React to new messages as they're created

### Integration Use Cases  
- **Memory Systems**: Feed conversation history to AI memory systems
- **Analytics Dashboards**: Power usage analytics and insights
- **Backup Systems**: Maintain structured backups of conversation data
- **API Backends**: Provide REST/GraphQL access to conversation data

## Data Flow

```
Claude Code → JSONL Files → File Watcher → Parser → SQLite → Transaction Log
     ↑                                                              ↓
User Activity                                              Downstream Systems
```

## System Boundaries

### In Scope
- JSONL file parsing and validation
- SQLite database operations
- Real-time file monitoring
- Data transformation and normalization
- Transaction logging
- Docker deployment

### Out of Scope
- JSONL file creation (handled by Claude Code)
- Advanced analytics (consumer responsibility)
- Authentication/authorization
- Network APIs (local file system only)
- Data visualization

## Quality Attributes

### Performance
- **Latency**: Sub-second sync for new messages
- **Throughput**: Handle multiple concurrent file changes
- **Resource Usage**: Minimal CPU/memory footprint

### Reliability
- **Data Integrity**: No message loss or corruption
- **Fault Tolerance**: Graceful handling of malformed JSONL
- **Recovery**: Resume sync after interruption

### Maintainability  
- **Type Safety**: Full TypeScript coverage
- **Testing**: Comprehensive unit and integration tests
- **Logging**: Detailed transaction and error logging
- **Documentation**: Clear API and deployment docs