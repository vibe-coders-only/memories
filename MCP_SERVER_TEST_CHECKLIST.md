# MCP Server Testing Checklist

## Prerequisites

### Environment Setup
- [ ] Ensure Node.js 20+ is installed
- [ ] Run `npm install` to install all dependencies  
- [ ] Verify SQLite database exists at `~/.local/share/memory-sqlite/claude_code.db`
- [ ] Ensure Claude Code conversation data exists in `~/.claude/projects/`
- [ ] Verify database has been synced with at least some test data

### Initial Data Sync
- [ ] Run one-time sync: `npm run cli sync`
- [ ] Verify database tables are created (sessions, messages, tool_uses, tool_use_results, attachments, env_info)
- [ ] Check transaction log exists at `~/.local/share/memory-sqlite/mem_db_changes.jsonl`
- [ ] Verify data has been populated in all tables

## Unit Tests

### Run Existing Test Suite
- [ ] Execute: `npm test`
- [ ] Verify all integration tests pass in `tests/integration/mcp-server.test.ts`
- [ ] Check test coverage for:
  - Query functions (searchMessages, searchSessions, getContext, getSummary)
  - Rate limiting functionality
  - Query complexity analysis
  - SQL injection protection
  - Error handling

## Manual MCP Server Testing

### 1. Basic Server Startup
- [ ] Start MCP server: `npm run mcp-server`
- [ ] Verify server starts without errors
- [ ] Check server responds to stdio transport
- [ ] Confirm tool schemas are loaded

### 2. Query Memory Tool Testing

#### Basic Queries
- [ ] Test simple SELECT: `SELECT * FROM messages LIMIT 5`
- [ ] Test with WHERE clause: `SELECT * FROM messages WHERE type = 'user' LIMIT 10`
- [ ] Test JOIN query: `SELECT m.*, tu.toolName FROM messages m LEFT JOIN tool_uses tu ON m.id = tu.messageId LIMIT 10`
- [ ] Test date filtering: `SELECT * FROM messages WHERE timestamp > datetime('now', '-7 days')`
- [ ] Test COUNT aggregation: `SELECT COUNT(*) FROM messages`
- [ ] Test GROUP BY: `SELECT toolName, COUNT(*) FROM tool_uses GROUP BY toolName`

#### Complex Queries  
- [ ] Test subquery: `SELECT * FROM messages WHERE sessionId IN (SELECT sessionId FROM sessions WHERE sessionPath LIKE '%/project1%')`
- [ ] Test multiple JOINs: Query joining messages, tool_uses, and tool_use_results
- [ ] Test text search: `SELECT * FROM messages WHERE userText LIKE '%search term%' OR assistantText LIKE '%search term%'`
- [ ] Test session timeline query from schema examples
- [ ] Test tool usage analytics query from schema examples

#### Edge Cases
- [ ] Test empty result set query
- [ ] Test query with LIMIT > 1000 (should cap at 1000)
- [ ] Test query with LIMIT = 0 or negative (should handle gracefully)
- [ ] Test malformed SQL (should return error)
- [ ] Test non-SELECT statements (INSERT, UPDATE, DELETE - should be rejected)
- [ ] Test query timeout handling for complex queries

### 3. Security Testing

#### SQL Injection Prevention
- [ ] Test injection attempt: `'; DROP TABLE messages; --`
- [ ] Test OR injection: `1' OR '1'='1`
- [ ] Test UNION injection: `' UNION SELECT * FROM sessions--`
- [ ] Test comment injection: `admin'--`
- [ ] Verify all queries use parameterized statements
- [ ] Confirm tables remain intact after injection attempts

#### Access Control
- [ ] Verify only SELECT queries are allowed
- [ ] Test CREATE/DROP/ALTER statements are rejected
- [ ] Test INSERT/UPDATE/DELETE statements are rejected
- [ ] Verify read-only database connection

### 4. Performance Testing

#### Query Performance
- [ ] Test query on large dataset (70k+ messages)
- [ ] Verify indexed columns perform efficiently:
  - sessionId queries
  - timestamp queries
  - type queries
  - messageId queries
  - toolName queries
- [ ] Test query with LIMIT vs without LIMIT performance
- [ ] Monitor memory usage during large queries

#### Rate Limiting
- [ ] Test 60 requests per minute limit
- [ ] Verify rate limit reset after cooldown
- [ ] Test weight-based limiting for complex queries
- [ ] Verify client-specific rate limiting
- [ ] Test rate limit status endpoint

### 5. Integration Testing

#### Docker Environment
- [ ] Build Docker image: `docker compose build`
- [ ] Start sync daemon: `docker compose up -d`
- [ ] Check logs: `docker compose logs -f`
- [ ] Test one-time sync: `docker compose --profile sync-once up memory-sqlite-sync-once`
- [ ] Verify volume mounts are correct (read-only for Claude projects)
- [ ] Test MCP server in containerized environment

#### Claude Code Integration
- [ ] Configure MCP server in Claude Code settings
- [ ] Test natural language queries that translate to SQL
- [ ] Verify tool response format matches Claude Code expectations
- [ ] Test error handling and user-friendly error messages
- [ ] Validate tool descriptions are helpful for Claude

### 6. Data Integrity Testing

#### Foreign Key Constraints
- [ ] Verify FK relationships are enforced:
  - messages.sessionId → sessions.sessionId
  - tool_uses.messageId → messages.id
  - tool_use_results.toolUseId → tool_uses.id
  - attachments.messageId → messages.id
  - env_info.messageId → messages.id
- [ ] Test cascade behavior on deletes (if applicable)

#### Data Consistency
- [ ] Verify tool_uses.id matches original JSONL format (toolu_*)
- [ ] Check timestamps are properly formatted ISO strings
- [ ] Validate JSON fields (parameters, userAttachments) are valid JSON
- [ ] Confirm boolean fields store 0/1 correctly

### 7. Error Handling & Recovery

#### Error Scenarios
- [ ] Test database connection failure
- [ ] Test corrupted database recovery
- [ ] Test missing database file
- [ ] Test permission issues on database file
- [ ] Test JSONL parsing errors
- [ ] Test network timeout handling

#### Graceful Degradation
- [ ] Verify helpful error messages for users
- [ ] Test partial query results on timeout
- [ ] Confirm server doesn't crash on errors
- [ ] Test transaction rollback on failures

### 8. Monitoring & Observability

#### Logging
- [ ] Verify query logging (without sensitive data)
- [ ] Check error logging with stack traces
- [ ] Test transaction log entries
- [ ] Validate performance metrics logging

#### Health Checks
- [ ] Test health endpoint (if available)
- [ ] Verify database connection status
- [ ] Check sync status reporting
- [ ] Monitor resource usage metrics

### 9. CLI Testing

#### Commands
- [ ] Test `npm run cli sync` - one-time sync
- [ ] Test `npm run cli start` - start daemon
- [ ] Test `npm run cli stop` - stop daemon  
- [ ] Test `npm run cli status` - check status
- [ ] Verify proper exit codes
- [ ] Test interrupt handling (SIGINT/SIGTERM)

### 10. End-to-End Scenarios

#### Complete Workflow
- [ ] Fresh install and setup
- [ ] Initial sync of large dataset
- [ ] Query recent conversations
- [ ] Search for specific content
- [ ] Analyze tool usage patterns
- [ ] Export query results
- [ ] Handle concurrent queries
- [ ] Incremental sync of new conversations

#### User Stories
- [ ] "Find all conversations about Docker"
- [ ] "Show me errors from the last week"  
- [ ] "Which tools do I use most frequently?"
- [ ] "Find conversations in specific project"
- [ ] "Show conversation context around an error"

## Documentation Verification

- [ ] README.md accurately describes setup process
- [ ] CLAUDE.md provides correct guidance for Claude Code
- [ ] API documentation matches implementation
- [ ] Example queries work as documented
- [ ] Error messages are clear and actionable

## Sign-off

- [ ] All critical paths tested
- [ ] Performance meets requirements
- [ ] Security controls verified
- [ ] Integration with Claude Code confirmed
- [ ] Documentation complete and accurate
- [ ] Ready for production use

---

**Notes:**
- Database location: `~/.local/share/memory-sqlite/claude_code.db`
- Transaction log: `~/.local/share/memory-sqlite/mem_db_changes.jsonl`
- Test database for unit tests: `tests/temp/mcp-test.db`
- Production data is read-only mounted from `~/.claude/projects/`