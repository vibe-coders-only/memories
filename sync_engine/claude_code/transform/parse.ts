// Parse Claude Code JSONL entries and extract structured data
import { classifyMessage, shouldStoreAsMessage, extractMessageText } from './message_classifier.js';
import { extractToolUses, extractToolResults } from './tool_extractor.js';
import { 
  mapToMessageRecord, 
  mapToToolUseRecord, 
  mapToToolResultRecord,
  createSessionRecord,
  extractEnvInfo,
  extractAttachments,
  validateRecords
} from './schema_mapper.js';
import type { MessageRecord, ToolUseRecord, ToolResultRecord, AttachmentRecord, EnvInfoRecord, SessionRecord } from './schema_mapper.js';

export interface ParsedEntry {
  session: SessionRecord;
  message: MessageRecord | null;
  toolUses: ToolUseRecord[];
  toolResults: ToolResultRecord[];
  attachments: AttachmentRecord[];
  envInfo: EnvInfoRecord | null;
  shouldSkipMessage: boolean;
  errors: string[];
}

/**
 * Parse and transform a Claude Code JSONL entry into structured database records
 */
export function parseAndTransform(entry: any, sessionPath: string = ''): ParsedEntry {
  try {
    // Step 1: Classify the message
    const classified = classifyMessage(entry);
    
    // Step 2: Create session record
    const session = createSessionRecord(classified, sessionPath);
    
    // Step 3: Extract tool data
    const { toolUses } = extractToolUses(entry);
    const { toolResults } = extractToolResults(entry);
    
    // Step 4: Extract message text content
    const { userText, assistantText } = extractMessageText(entry, classified.type);
    
    // Step 5: Determine if we should store this as a message record
    const shouldSkipMessage = !shouldStoreAsMessage(classified);
    
    let message: MessageRecord | null = null;
    if (!shouldSkipMessage) {
      message = mapToMessageRecord(classified, userText, assistantText);
    }
    
    // Step 6: Extract auxiliary data
    const attachments = extractAttachments(classified);
    const envInfo = extractEnvInfo(classified);
    
    // Step 7: Map to database records
    const mappedToolUses = toolUses.map(mapToToolUseRecord);
    const mappedToolResults = toolResults.map(mapToToolResultRecord);
    
    // Step 8: Validate records
    const validation = validateRecords({
      messages: message ? [message] : [],
      toolUses: mappedToolUses,
      toolResults: mappedToolResults,
      attachments,
      envInfo: envInfo ? [envInfo] : []
    });
    
    return {
      session,
      message,
      toolUses: mappedToolUses,
      toolResults: mappedToolResults,
      attachments,
      envInfo,
      shouldSkipMessage,
      errors: validation.errors
    };
    
  } catch (error) {
    console.error('Error parsing JSONL entry:', error);
    
    // Return minimal session record on error
    return {
      session: {
        id: entry.sessionId || 'unknown',
        sessionId: entry.sessionId || 'unknown',
        sessionPath
      },
      message: null,
      toolUses: [],
      toolResults: [],
      attachments: [],
      envInfo: null,
      shouldSkipMessage: true,
      errors: [`Parse error: ${error.message}`]
    };
  }
}

/**
 * Parse multiple JSONL entries in batch
 */
export function parseMultipleEntries(entries: any[], sessionPath: string = ''): ParsedEntry[] {
  return entries.map(entry => parseAndTransform(entry, sessionPath));
}

/**
 * Get parsing statistics for a batch of parsed entries
 */
export function getParsingStats(parsed: ParsedEntry[]): {
  total: number;
  messages: number;
  toolUses: number;
  toolResults: number;
  errors: number;
  skipped: number;
} {
  return {
    total: parsed.length,
    messages: parsed.filter(p => p.message !== null).length,
    toolUses: parsed.reduce((sum, p) => sum + p.toolUses.length, 0),
    toolResults: parsed.reduce((sum, p) => sum + p.toolResults.length, 0),
    errors: parsed.reduce((sum, p) => sum + p.errors.length, 0),
    skipped: parsed.filter(p => p.shouldSkipMessage).length
  };
}