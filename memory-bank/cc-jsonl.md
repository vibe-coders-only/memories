# Claude Code JSONL Findings

## Key Patterns
- **3 message types**: summary, user, assistant
- **"User" masquerade**: Tool results appear as user messages with toolUseResult metadata
- **Task sidechains**: Only Task tool triggers isSidechain: true contexts for multi-threading
- **Threading**: parentUuid creates conversation trees, sidechains reset to null but correlate via tool_use_id in same file

## Data Structure
- **Comprehensive types**: sync_engine/claude_code/types.ts
- **Tool taxonomy**: Read, Write, Bash, Edit, Task, etc.
- **Content variants**: text, tool_use, tool_result
- **Session metadata**: UUID, project paths, timestamps, token usage

## Architecture Insights
- **Multi-threading primitive**: Task tool spawns isolated context agents
- **Context isolation**: Sidechains never reference main thread UUIDs
- **Tool execution flow**: Assistant � tool_use � "User" � tool_result � Assistant continues