// Map extracted tool data to SQLite database schemas
import type { ToolUseData, ToolResultData } from './tool_extractor.js';
import type { ClassifiedMessage } from './message_classifier.js';

export interface SessionRecord {
  id: string;
  sessionId: string;
  sessionPath: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  isSidechain: boolean;
  projectName: string | null;
  activeFile: string | null;
  userText: string | null;
  userType: string | null;
  userAttachments: string | null;
  toolUseResultId: string | null;
  toolUseResultName: string | null;
  assistantRole: string | null;
  assistantText: string | null;
  assistantModel: string | null;
}

export interface ToolUseRecord {
  id: string;
  messageId: string;
  toolId: string;
  toolName: string;
  parameters: string;
}

export interface ToolResultRecord {
  id: string;
  toolUseId: string;
  messageId: string;
  output: string | null;
  outputMimeType: string | null;
  error: string | null;
  errorType: string | null;
}

export interface AttachmentRecord {
  id: string;
  messageId: string;
  type: string;
  text: string | null;
  url: string | null;
  mimeType: string | null;
  title: string | null;
  filePath: string | null;
}

export interface EnvInfoRecord {
  id: string;
  messageId: string;
  workingDirectory: string | null;
  isGitRepo: boolean | null;
  platform: string | null;
  osVersion: string | null;
  todaysDate: string | null;
}

/**
 * Map classified message to database message record
 */
export function mapToMessageRecord(classified: ClassifiedMessage, userText: string | null, assistantText: string | null): MessageRecord {
  const entry = classified.originalMessage;
  
  return {
    id: classified.messageId,
    sessionId: classified.sessionId,
    type: mapMessageType(classified.type),
    timestamp: classified.timestamp,
    isSidechain: entry.isSidechain || false,
    projectName: null, // Set by caller if summary message
    activeFile: null, // Set by caller if summary message
    userText,
    userType: entry.userType || null,
    userAttachments: null, // TODO: Extract attachments
    toolUseResultId: null,
    toolUseResultName: null,
    assistantRole: entry.message?.role || null,
    assistantText,
    assistantModel: entry.message?.model || null
  };
}

/**
 * Map message type to database type
 */
function mapMessageType(type: string): string {
  switch (type) {
    case 'user_message':
    case 'tool_result_message':
      return 'user';
    case 'assistant_message':
    case 'tool_use_message':
      return 'assistant';
    case 'system_message':
      return 'system';
    case 'summary_message':
      return 'summary';
    default:
      return 'unknown';
  }
}

/**
 * Map tool use data to database record
 */
export function mapToToolUseRecord(toolUse: ToolUseData): ToolUseRecord {
  return {
    id: toolUse.id,
    messageId: toolUse.messageId,
    toolId: toolUse.toolId,
    toolName: toolUse.toolName,
    parameters: toolUse.parameters
  };
}

/**
 * Map tool result data to database record
 */
export function mapToToolResultRecord(toolResult: ToolResultData): ToolResultRecord {
  return {
    id: toolResult.id,
    toolUseId: toolResult.toolUseId,
    messageId: toolResult.messageId,
    output: toolResult.output,
    outputMimeType: null, // Could be extracted from content type if available
    error: toolResult.error,
    errorType: null // Could be extracted from error data if available
  };
}

/**
 * Create session record from classified message
 */
export function createSessionRecord(classified: ClassifiedMessage, sessionPath: string): SessionRecord {
  return {
    id: classified.sessionId,
    sessionId: classified.sessionId,
    sessionPath
  };
}

/**
 * Extract attachment records from message (if any)
 */
export function extractAttachments(classified: ClassifiedMessage): AttachmentRecord[] {
  // TODO: Implement attachment extraction based on message content
  // For now, return empty array
  return [];
}

/**
 * Extract environment info from message
 */
export function extractEnvInfo(classified: ClassifiedMessage): EnvInfoRecord | null {
  const entry = classified.originalMessage;
  
  // Only extract env info if available in the message
  if (!entry.cwd && !entry.platform && !entry.gitBranch) {
    return null;
  }

  return {
    id: `env_${classified.messageId}`,
    messageId: classified.messageId,
    workingDirectory: entry.cwd || null,
    isGitRepo: entry.gitBranch ? true : null,
    platform: entry.platform || null,
    osVersion: entry.osVersion || null,
    todaysDate: null // Could extract from timestamp if needed
  };
}

/**
 * Validate required fields for database insertion
 */
export function validateRecords(records: {
  messages: MessageRecord[];
  toolUses: ToolUseRecord[];
  toolResults: ToolResultRecord[];
  attachments: AttachmentRecord[];
  envInfo: EnvInfoRecord[];
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate messages
  for (const msg of records.messages) {
    const missingFields = [];
    if (!msg.id) missingFields.push('id');
    if (!msg.sessionId) missingFields.push('sessionId');
    if (!msg.type) missingFields.push('type');
    if (!msg.timestamp) missingFields.push('timestamp');
    
    if (missingFields.length > 0) {
      errors.push(`Invalid message record ${msg.id || 'unknown'}: missing fields [${missingFields.join(', ')}]`);
    }
  }

  // Validate tool uses
  for (const tool of records.toolUses) {
    const missingFields = [];
    if (!tool.id) missingFields.push('id');
    if (!tool.messageId) missingFields.push('messageId');
    if (!tool.toolId) missingFields.push('toolId');
    if (!tool.toolName) missingFields.push('toolName');
    
    if (missingFields.length > 0) {
      errors.push(`Invalid tool use record ${tool.id || 'unknown'}: missing fields [${missingFields.join(', ')}]`);
    }
  }

  // Validate tool results
  for (const result of records.toolResults) {
    const missingFields = [];
    if (!result.id) missingFields.push('id');
    if (!result.toolUseId) missingFields.push('toolUseId');
    if (!result.messageId) missingFields.push('messageId');
    
    if (missingFields.length > 0) {
      errors.push(`Invalid tool result record ${result.id || 'unknown'}: missing fields [${missingFields.join(', ')}]`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}