// Claude Code WTE pipeline
import { watchJsonl } from './watch/index.js';
import { parseAndTransform, parseMultipleEntries, getParsingStats } from './transform/index.js';
import { executeToDatabase, executeParsedEntries } from '../execute/index.js';
import { initializeDatabase } from '../execute/schema.js';
import { getProjectsPath } from '../utils/paths.js';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { ClaudeCodeJSONLStream } from '../utils/jsonl_stream.js';

async function processJsonlFile(filePath: string) {
  const sessionId = filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown';
  console.log(`DEBUG: Processing JSONL file: ${filePath}`);
  console.log(`DEBUG: Extracted session ID: ${sessionId}`);
  
  try {
    // Check file size to decide on streaming vs in-memory
    const stats = statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    console.log(`DEBUG: File size: ${fileSizeMB.toFixed(2)} MB`);
    
    // Use streaming for files larger than 10MB
    if (fileSizeMB > 10) {
      console.log(`DEBUG: Using streaming for large file`);
      
      const stream = new ClaudeCodeJSONLStream({
        batchSize: 50,
        maxLineLength: 50 * 1024 * 1024 // 50MB max line
      });
      
      let totalProcessed = 0;
      
      await stream.processClaudeFile(filePath, async (entries) => {
        // Parse messages using enhanced parser
        const parsedEntries = parseMultipleEntries(entries, filePath);
        const stats = getParsingStats(parsedEntries);
        
        console.log(`DEBUG: Batch parsing stats - total: ${stats.total}, messages: ${stats.messages}, toolUses: ${stats.toolUses}, toolResults: ${stats.toolResults}, errors: ${stats.errors}, skipped: ${stats.skipped}`);
        
        // Execute parsed entries to database
        if (parsedEntries.length > 0) {
          await executeParsedEntries(parsedEntries, sessionId);
          totalProcessed += parsedEntries.length;
        }
      });
      
      console.log(`DEBUG: Streaming complete. Total entries processed: ${totalProcessed}`);
      return;
    }
    
    // For smaller files, use existing in-memory processing
    console.log(`DEBUG: Reading file content from: ${filePath}`);
    const content = readFileSync(filePath, 'utf8');
    console.log(`DEBUG: File content length: ${content.length} characters`);
    
    const lines = content.trim().split('\n').filter(line => line.trim());
    console.log(`DEBUG: Found ${lines.length} non-empty lines`);
    
    const rawMessages = lines.map(line => JSON.parse(line));
    console.log(`DEBUG: Parsed ${rawMessages.length} JSON messages`);
    
    // Parse messages using enhanced parser
    const parsedEntries = parseMultipleEntries(rawMessages, filePath);
    const parsingStats = getParsingStats(parsedEntries);
    
    console.log(`DEBUG: Parsing stats - total: ${parsingStats.total}, messages: ${parsingStats.messages}, toolUses: ${parsingStats.toolUses}, toolResults: ${parsingStats.toolResults}, errors: ${parsingStats.errors}, skipped: ${parsingStats.skipped}`);
    
    // Execute to database using new method
    const result = executeParsedEntries(parsedEntries);
    
    console.log(`DEBUG: Database operation complete:`);
    console.log(`  - Messages inserted: ${result.messagesInserted}, updated: ${result.messagesUpdated}`);
    console.log(`  - Tool uses inserted: ${result.toolUsesInserted}`);
    console.log(`  - Tool results inserted: ${result.toolResultsInserted}`);
    console.log(`  - Attachments inserted: ${result.attachmentsInserted}`);
    console.log(`  - Env info inserted: ${result.envInfoInserted}`);
    console.log(`  - Errors: ${result.errors.length}`);
    
    const totalInserted = result.messagesInserted + result.toolUsesInserted + result.toolResultsInserted;
    console.log(`Synced ${totalInserted} records from ${sessionId} (${parsingStats.toolUses} tool calls extracted)`);
    
    if (result.errors && result.errors.length > 0) {
      console.error(`Errors in ${sessionId}:`, result.errors.slice(0, 3)); // Show first 3 errors
    }
  } catch (error) {
    console.error(`ERROR: Failed to process ${filePath}:`, error);
    console.error(`ERROR: Error stack:`, error.stack);
  }
}

export async function runClaudeCodeSync() {
  console.log('Claude Code sync pipeline starting...');
  
  // Initialize database
  initializeDatabase();
  
  // Initial sync of all existing files  
  const projectsDir = getProjectsPath();
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const projectDir of projectDirs) {
    const projectPath = join(projectsDir, projectDir);
    const files = readdirSync(projectPath)
      .filter(file => file.endsWith('.jsonl'));
    
    if (files.length === 0) continue;
    
    for (const file of files) {
      const filePath = join(projectPath, file);
      await processJsonlFile(filePath);
    }
  }
  
  console.log('Initial sync complete');
}

export async function startWatching() {
  console.log('Starting real-time sync...');
  initializeDatabase();
  
  console.log('Performing initial sync on startup...');
  await runClaudeCodeSync();
  
  console.log('Starting file watcher...');
  return watchJsonl(async (filePath) => {
    console.log(`File watcher triggered for: ${filePath}`);
    await processJsonlFile(filePath);
  });
}

