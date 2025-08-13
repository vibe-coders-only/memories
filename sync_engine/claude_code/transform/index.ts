// Transform exports
export { parseAndTransform, parseMultipleEntries, getParsingStats } from './parse.js';
export { classifyMessage, shouldStoreAsMessage, extractMessageText } from './message_classifier.js';
export { extractToolUses, extractToolResults, containsTools, getCleanTextContent } from './tool_extractor.js';
export { 
  mapToMessageRecord, 
  mapToToolUseRecord, 
  mapToToolResultRecord,
  createSessionRecord,
  extractEnvInfo,
  extractAttachments,
  validateRecords
} from './schema_mapper.js';

// Type exports
export type { ParsedEntry } from './parse.js';
export type { MessageType, ClassifiedMessage } from './message_classifier.js';
export type { ToolUseData, ToolResultData, CleanedMessage } from './tool_extractor.js';
export type { 
  SessionRecord, 
  MessageRecord, 
  ToolUseRecord, 
  ToolResultRecord, 
  AttachmentRecord, 
  EnvInfoRecord 
} from './schema_mapper.js';
