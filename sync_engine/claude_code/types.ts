// Claude Code JSONL Types
// Generated from comprehensive analysis of ~/.claude/projects/ data

// === Core Message Types ===

export type ClaudeCodeMessage = SummaryMessage | UserMessage | AssistantMessage;

export interface SummaryMessage {
  type: "summary";
  summary: string;
  leafUuid: string;
}

export interface UserMessage {
  type: "user";
  parentUuid: string | null;
  isSidechain: boolean;
  userType: "external"; // Only "external" observed
  cwd: string;
  sessionId: string;
  version: string; // e.g. "1.0.56"
  gitBranch?: string;
  timestamp: string; // ISO 8601
  uuid: string;
  message: {
    role: "user";
    content: MessageContent[];
  };
  isMeta?: boolean; // For meta operations
  toolUseResult?: ToolUseResultMetadata;
}

export interface AssistantMessage {
  type: "assistant";
  parentUuid: string;
  isSidechain: boolean;
  userType: "external";
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
  timestamp: string;
  uuid: string;
  message: {
    id: string; // e.g. "msg_01HcamE..."
    type: "message";
    role: "assistant";
    model: string; // e.g. "claude-sonnet-4-20250514"
    content: MessageContent[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: UsageMetadata;
  };
  requestId: string;
}

// === Content Types ===

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string; // e.g. "toolu_01YALq..."
  name: ToolName;
  input: Record<string, any>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string | ToolResultFile;
  is_error?: boolean;
}

// === Tool Types ===

export type ToolName = 
  | "Read" | "Write" | "Edit" | "MultiEdit"
  | "Bash" | "LS" | "Grep" | "Glob"
  | "Task" | "ExitPlanMode" | "NotebookRead" | "NotebookEdit"
  | "WebFetch" | "TodoWrite" | "WebSearch"
  | string; // Allow unknown tools

export interface ToolResultFile {
  type: "text";
  file: {
    filePath: string;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
}

export interface ToolUseResultMetadata {
  type: "text";
  file?: {
    filePath: string;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  wasInterrupted?: boolean;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  usage?: UsageMetadata;
}

// === Metadata Types ===

export interface UsageMetadata {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  service_tier: "standard" | string;
}

export interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  encodedProjectPath: string; // e.g. "-home-alex-code-cafedelia"
  messageCount: number;
  lastActivity: string;
  firstActivity: string;
  toolsUsed: string[];
  gitBranch?: string;
  workingDirectory: string;
  claudeVersion: string;
}

// === Derived Session Analysis Types ===

export interface ParsedSession {
  metadata: SessionMetadata;
  messages: ClaudeCodeMessage[];
  summary?: string;
}

// === Utility Types ===

export type MessageRole = "user" | "assistant";
export type MessageType = "summary" | "user" | "assistant";
export type UserType = "external";
export type ServiceTier = "standard" | string;