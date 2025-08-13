// Test tool extraction functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { extractToolUses, extractToolResults, containsTools } from '../sync_engine/claude_code/transform/tool_extractor.js';
import { classifyMessage } from '../sync_engine/claude_code/transform/message_classifier.js';
import { parseAndTransform } from '../sync_engine/claude_code/transform/parse.js';

describe('Tool Extraction', () => {
  const mockToolUseMessage = {
    uuid: 'msg-123',
    sessionId: 'session-abc',
    type: 'assistant',
    timestamp: '2025-01-01T12:00:00Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I\'ll read the file for you.' },
        {
          type: 'tool_use',
          id: 'toolu_01abc123',
          name: 'Read',
          input: { file_path: '/test/file.txt' }
        }
      ]
    }
  };

  const mockToolResultMessage = {
    uuid: 'msg-456',
    sessionId: 'session-abc',
    type: 'user',
    timestamp: '2025-01-01T12:01:00Z',
    parentUuid: 'msg-123',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01abc123',
          content: 'File contents here...'
        }
      ]
    }
  };

  const mockPureTextMessage = {
    uuid: 'msg-789',
    sessionId: 'session-abc',
    type: 'user',
    timestamp: '2025-01-01T12:02:00Z',
    message: {
      role: 'user',
      content: 'Just a regular text message'
    }
  };

  describe('containsTools', () => {
    it('should detect tool_use in content array', () => {
      expect(containsTools(mockToolUseMessage)).toBe(true);
    });

    it('should detect tool_result in content array', () => {
      expect(containsTools(mockToolResultMessage)).toBe(true);
    });

    it('should return false for pure text messages', () => {
      expect(containsTools(mockPureTextMessage)).toBe(false);
    });

    it('should return false for messages without content', () => {
      const emptyMessage = { uuid: 'msg-empty', sessionId: 'session-abc', type: 'user' };
      expect(containsTools(emptyMessage)).toBe(false);
    });
  });

  describe('extractToolUses', () => {
    it('should extract tool use from assistant message', () => {
      const result = extractToolUses(mockToolUseMessage);
      
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0]).toMatchObject({
        messageId: 'msg-123',
        toolId: 'toolu_01abc123',
        toolName: 'Read',
        parameters: JSON.stringify({ file_path: '/test/file.txt' })
      });
      expect(result.toolUses[0].id).toBeDefined();
      
      // Should clean the message content
      expect(result.cleanedMessage.hasTools).toBe(true);
      expect(result.cleanedMessage.cleanedContent).toHaveLength(1);
      expect(result.cleanedMessage.cleanedContent[0]).toEqual({
        type: 'text',
        text: 'I\'ll read the file for you.'
      });
    });

    it('should return empty array for messages without tool uses', () => {
      const result = extractToolUses(mockPureTextMessage);
      expect(result.toolUses).toHaveLength(0);
      expect(result.cleanedMessage.hasTools).toBe(false);
    });
  });

  describe('extractToolResults', () => {
    it('should extract tool result from user message', () => {
      const result = extractToolResults(mockToolResultMessage);
      
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0]).toMatchObject({
        messageId: 'msg-456',
        toolUseId: 'toolu_01abc123',
        output: 'File contents here...',
        error: null
      });
      expect(result.toolResults[0].id).toBeDefined();
      
      // Should clean the message content (remove tool_result)
      expect(result.cleanedMessage.hasTools).toBe(true);
      expect(result.cleanedMessage.cleanedContent).toHaveLength(0);
    });

    it('should return empty array for messages without tool results', () => {
      const result = extractToolResults(mockPureTextMessage);
      expect(result.toolResults).toHaveLength(0);
      expect(result.cleanedMessage.hasTools).toBe(false);
    });
  });

  describe('Message Classification', () => {
    it('should classify tool use message correctly', () => {
      const classified = classifyMessage(mockToolUseMessage);
      
      expect(classified.type).toBe('tool_use_message');
      expect(classified.isToolMessage).toBe(true);
      expect(classified.hasTextContent).toBe(true);
      expect(classified.messageId).toBe('msg-123');
      expect(classified.sessionId).toBe('session-abc');
    });

    it('should classify tool result message correctly', () => {
      const classified = classifyMessage(mockToolResultMessage);
      
      expect(classified.type).toBe('tool_result_message');
      expect(classified.isToolMessage).toBe(true);
      expect(classified.hasTextContent).toBe(false); // tool_result only
      expect(classified.parentId).toBe('msg-123');
    });

    it('should classify pure text message correctly', () => {
      const classified = classifyMessage(mockPureTextMessage);
      
      expect(classified.type).toBe('user_message');
      expect(classified.isToolMessage).toBe(false);
      expect(classified.hasTextContent).toBe(true);
    });
  });

  describe('Full Parse Pipeline', () => {
    it('should parse tool use message correctly', () => {
      const result = parseAndTransform(mockToolUseMessage, '/test/session.jsonl');
      
      expect(result.session.sessionId).toBe('session-abc');
      expect(result.message).not.toBeNull();
      expect(result.message!.type).toBe('assistant');
      expect(result.message!.assistantText).toBe('I\'ll read the file for you.');
      
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].toolName).toBe('Read');
      expect(result.toolResults).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse tool result message correctly', () => {
      const result = parseAndTransform(mockToolResultMessage, '/test/session.jsonl');
      
      expect(result.session.sessionId).toBe('session-abc');
      expect(result.shouldSkipMessage).toBe(true); // Pure tool result, no text
      expect(result.message).toBeNull();
      
      expect(result.toolUses).toHaveLength(0);
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].toolUseId).toBe('toolu_01abc123');
      expect(result.toolResults[0].output).toBe('File contents here...');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle parsing errors gracefully', () => {
      const invalidMessage = { invalid: 'structure' };
      const result = parseAndTransform(invalidMessage, '/test/session.jsonl');
      
      expect(result.errors).toHaveLength(0); // Should handle gracefully
      expect(result.session).toBeDefined();
      expect(result.message).toBeNull();
      expect(result.shouldSkipMessage).toBe(true);
    });
  });

  describe('Complex Tool Messages', () => {
    it('should handle multiple tool uses in one message', () => {
      const multiToolMessage = {
        ...mockToolUseMessage,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I\'ll do two things.' },
            {
              type: 'tool_use',
              id: 'toolu_01abc123',
              name: 'Read',
              input: { file_path: '/test/file1.txt' }
            },
            {
              type: 'tool_use', 
              id: 'toolu_02def456',
              name: 'Write',
              input: { file_path: '/test/file2.txt', content: 'test' }
            }
          ]
        }
      };

      const result = extractToolUses(multiToolMessage);
      expect(result.toolUses).toHaveLength(2);
      expect(result.toolUses[0].toolName).toBe('Read');
      expect(result.toolUses[1].toolName).toBe('Write');
      expect(result.cleanedMessage.cleanedContent).toHaveLength(1);
      expect(result.cleanedMessage.cleanedContent[0].type).toBe('text');
    });

    it('should handle tool result with error', () => {
      const errorResultMessage = {
        ...mockToolResultMessage,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01abc123',
              error: 'File not found'
            }
          ]
        }
      };

      const result = extractToolResults(errorResultMessage);
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].output).toBeNull();
      expect(result.toolResults[0].error).toBe('File not found');
    });
  });
});