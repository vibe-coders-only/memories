// Classify Claude Code JSONL message types
import { containsTools } from './tool_extractor.js';

export type MessageType = 
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'summary_message'
  | 'tool_use_message'
  | 'tool_result_message'
  | 'unknown';

export interface ClassifiedMessage {
  type: MessageType;
  originalMessage: any;
  isToolMessage: boolean;
  hasTextContent: boolean;
  sessionId: string;
  messageId: string;
  parentId: string | null;
  timestamp: string;
}

/**
 * Classify a Claude Code JSONL message entry
 */
export function classifyMessage(entry: any): ClassifiedMessage {
  const messageId = entry.uuid || '';
  const sessionId = entry.sessionId || '';
  const parentId = entry.parentUuid || null;
  const timestamp = entry.timestamp || new Date().toISOString();
  
  // Check for tool content
  const isToolMessage = containsTools(entry);
  const hasTextContent = hasNonToolTextContent(entry);

  let type: MessageType = 'unknown';

  // Classify based on entry type and message role
  if (entry.type === 'user') {
    if (isToolMessage) {
      type = 'tool_result_message';
    } else {
      type = 'user_message';
    }
  } else if (entry.type === 'assistant') {
    if (isToolMessage) {
      type = 'tool_use_message';
    } else {
      type = 'assistant_message';
    }
  } else if (entry.type === 'system') {
    type = 'system_message';
  } else if (entry.type === 'summary') {
    type = 'summary_message';
  }

  return {
    type,
    originalMessage: entry,
    isToolMessage,
    hasTextContent,
    sessionId,
    messageId,
    parentId,
    timestamp
  };
}

/**
 * Check if message has non-tool text content
 */
function hasNonToolTextContent(entry: any): boolean {
  if (!entry.message?.content) {
    return false;
  }

  if (typeof entry.message.content === 'string') {
    return entry.message.content.trim().length > 0;
  }

  if (Array.isArray(entry.message.content)) {
    return entry.message.content.some((item: any) => 
      item.type === 'text' && item.text && item.text.trim().length > 0
    );
  }

  return false;
}

/**
 * Determine if message should be stored in messages table
 * (excludes pure tool messages with no text content)
 */
export function shouldStoreAsMessage(classified: ClassifiedMessage): boolean {
  // Always store user/assistant messages with text content
  if (classified.hasTextContent) {
    return true;
  }

  // Always store system and summary messages
  if (classified.type === 'system_message' || classified.type === 'summary_message') {
    return true;
  }

  // Store tool messages only if they have additional text content
  // Pure tool messages (tool_use_message/tool_result_message with no text) 
  // are stored only in tool tables, not messages table
  return false;
}

/**
 * Extract message text content for storage
 */
export function extractMessageText(entry: any, messageType: MessageType): {
  userText: string | null;
  assistantText: string | null;
} {
  let userText: string | null = null;
  let assistantText: string | null = null;

  const textContent = getTextContent(entry);

  if (messageType === 'user_message' || messageType === 'tool_result_message') {
    userText = textContent || null;
  } else if (messageType === 'assistant_message' || messageType === 'tool_use_message') {
    assistantText = textContent || null;
  }

  return { userText, assistantText };
}

/**
 * Get text content from message, excluding tool objects
 */
function getTextContent(entry: any): string {
  if (!entry.message?.content) {
    return '';
  }

  if (typeof entry.message.content === 'string') {
    return entry.message.content;
  }

  if (Array.isArray(entry.message.content)) {
    const textItems = entry.message.content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text)
      .filter(Boolean);

    return textItems.join('\n');
  }

  return '';
}

/**
 * Get message metadata for database storage
 */
export function extractMessageMetadata(entry: any) {
  return {
    messageId: entry.uuid || '',
    sessionId: entry.sessionId || '',
    parentId: entry.parentUuid || null,
    timestamp: entry.timestamp || new Date().toISOString(),
    userType: entry.userType || null,
    cwd: entry.cwd || null,
    version: entry.version || null,
    gitBranch: entry.gitBranch || null,
    requestId: entry.requestId || null,
    model: entry.message?.model || null,
    usage: entry.message?.usage ? JSON.stringify(entry.message.usage) : null
  };
}