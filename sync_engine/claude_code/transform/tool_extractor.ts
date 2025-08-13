// Extract tool use/result data from Claude Code message content
import { v4 as uuidv4 } from 'uuid';

export interface ToolUseData {
  id: string;
  messageId: string;
  toolId: string;
  toolName: string;
  parameters: string; // JSON string
}

export interface ToolResultData {
  id: string;
  toolUseId: string;
  messageId: string;
  output: string | null;
  outputMimeType: string | null;
  error: string | null;
  errorType: string | null;
}

export interface CleanedMessage {
  originalMessage: any;
  cleanedContent: any[];
  hasTools: boolean;
}

/**
 * Extract tool_use objects from message content and return cleaned message
 */
export function extractToolUses(message: any): {
  toolUses: ToolUseData[];
  cleanedMessage: CleanedMessage;
} {
  const toolUses: ToolUseData[] = [];
  const cleanedContent: any[] = [];

  if (!message.message?.content || !Array.isArray(message.message.content)) {
    return {
      toolUses: [],
      cleanedMessage: {
        originalMessage: message,
        cleanedContent: message.message?.content || [],
        hasTools: false
      }
    };
  }

  // Process each content item
  for (const contentItem of message.message.content) {
    if (contentItem.type === 'tool_use') {
      // Extract tool use data
      const toolUse: ToolUseData = {
        id: contentItem.id, // Use original JSONL tool_use.id so tool_results can reference it
        messageId: message.uuid,
        toolId: contentItem.id, // Keep original ID for reference
        toolName: contentItem.name,
        parameters: JSON.stringify(contentItem.input || {})
      };
      toolUses.push(toolUse);
    } else {
      // Keep non-tool content (text, etc.)
      cleanedContent.push(contentItem);
    }
  }

  return {
    toolUses,
    cleanedMessage: {
      originalMessage: message,
      cleanedContent,
      hasTools: toolUses.length > 0
    }
  };
}

/**
 * Extract tool_result objects from message content and return cleaned message
 */
export function extractToolResults(message: any): {
  toolResults: ToolResultData[];
  cleanedMessage: CleanedMessage;
} {
  const toolResults: ToolResultData[] = [];
  const cleanedContent: any[] = [];

  if (!message.message?.content || !Array.isArray(message.message.content)) {
    return {
      toolResults: [],
      cleanedMessage: {
        originalMessage: message,
        cleanedContent: message.message?.content || [],
        hasTools: false
      }
    };
  }

  // Process each content item
  for (const contentItem of message.message.content) {
    if (contentItem.type === 'tool_result') {
      // Extract tool result data
      // Handle content that might be array or object
      let outputContent: string | null = null;
      if (contentItem.content) {
        if (typeof contentItem.content === 'string') {
          outputContent = contentItem.content;
        } else if (Array.isArray(contentItem.content)) {
          // Handle array of content items (e.g., text blocks)
          outputContent = contentItem.content
            .map((item: any) => typeof item === 'string' ? item : (item.text || JSON.stringify(item)))
            .join('\n');
        } else {
          outputContent = JSON.stringify(contentItem.content);
        }
      }
      
      const toolResult: ToolResultData = {
        id: uuidv4(),
        toolUseId: contentItem.tool_use_id,
        messageId: message.uuid,
        output: outputContent,
        outputMimeType: contentItem.content_type || null,
        error: contentItem.error || null,
        errorType: contentItem.error ? 'tool_error' : null
      };
      toolResults.push(toolResult);
    } else {
      // Keep non-tool content
      cleanedContent.push(contentItem);
    }
  }

  return {
    toolResults,
    cleanedMessage: {
      originalMessage: message,
      cleanedContent,
      hasTools: toolResults.length > 0
    }
  };
}

/**
 * Check if message content contains any tool-related objects
 */
export function containsTools(message: any): boolean {
  if (!message.message?.content || !Array.isArray(message.message.content)) {
    return false;
  }

  return message.message.content.some((item: any) => 
    item.type === 'tool_use' || item.type === 'tool_result'
  );
}

/**
 * Get clean text content from message, excluding tool objects
 */
export function getCleanTextContent(message: any): string {
  if (!message.message?.content || !Array.isArray(message.message.content)) {
    return '';
  }

  const textItems = message.message.content
    .filter((item: any) => item.type === 'text')
    .map((item: any) => item.text)
    .filter(Boolean);

  return textItems.join('\n');
}