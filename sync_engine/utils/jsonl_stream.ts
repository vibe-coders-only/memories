/**
 * Streaming JSONL file processor to handle large files without memory issues
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';

export interface JSONLStreamOptions {
  batchSize?: number;      // Number of lines to process in a batch
  maxLineLength?: number;  // Maximum line length to prevent memory issues
  encoding?: BufferEncoding;
}

export interface JSONLEntry {
  data: any;
  lineNumber: number;
  raw: string;
}

export interface ProcessingStats {
  totalLines: number;
  processedLines: number;
  errorLines: number;
  startTime: number;
  endTime?: number;
}

/**
 * Stream processor for JSONL files
 */
export class JSONLStreamProcessor extends EventEmitter {
  private stats: ProcessingStats;
  private currentBatch: JSONLEntry[] = [];
  private processing = false;
  private paused = false;
  
  constructor(private options: JSONLStreamOptions = {}) {
    super();
    
    // Set defaults
    this.options.batchSize = options.batchSize || 100;
    this.options.maxLineLength = options.maxLineLength || 10 * 1024 * 1024; // 10MB
    this.options.encoding = options.encoding || 'utf8';
    
    this.stats = {
      totalLines: 0,
      processedLines: 0,
      errorLines: 0,
      startTime: Date.now()
    };
  }
  
  /**
   * Process a JSONL file with streaming
   */
  async processFile(
    filePath: string,
    processor: (entries: JSONLEntry[]) => Promise<void>
  ): Promise<ProcessingStats> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, {
        encoding: this.options.encoding,
        highWaterMark: 64 * 1024 // 64KB chunks
      });
      
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity,
        // Prevent readline from buffering too much
        historySize: 0
      });
      
      let lineNumber = 0;
      
      rl.on('line', async (line) => {
        lineNumber++;
        this.stats.totalLines++;
        
        // Check line length
        if (line.length > this.options.maxLineLength!) {
          this.stats.errorLines++;
          this.emit('error-line', {
            lineNumber,
            error: 'Line exceeds maximum length',
            preview: line.substring(0, 100) + '...'
          });
          return;
        }
        
        // Skip empty lines
        if (!line.trim()) {
          return;
        }
        
        // Parse JSON
        try {
          const data = JSON.parse(line);
          this.currentBatch.push({
            data,
            lineNumber,
            raw: line
          });
          
          // Process batch if it's full
          if (this.currentBatch.length >= this.options.batchSize!) {
            // Pause reading while processing
            rl.pause();
            await this.processBatch(processor);
            rl.resume();
          }
        } catch (error) {
          this.stats.errorLines++;
          this.emit('parse-error', {
            lineNumber,
            error: error instanceof Error ? error.message : String(error),
            line: line.substring(0, 200)
          });
        }
      });
      
      rl.on('close', async () => {
        // Process remaining batch
        if (this.currentBatch.length > 0) {
          await this.processBatch(processor);
        }
        
        this.stats.endTime = Date.now();
        this.emit('complete', this.stats);
        resolve(this.stats);
      });
      
      rl.on('error', (error) => {
        this.emit('stream-error', error);
        reject(error);
      });
      
      stream.on('error', (error) => {
        this.emit('stream-error', error);
        reject(error);
      });
    });
  }
  
  /**
   * Process a batch of entries
   */
  private async processBatch(
    processor: (entries: JSONLEntry[]) => Promise<void>
  ): Promise<void> {
    if (this.currentBatch.length === 0) {
      return;
    }
    
    const batch = [...this.currentBatch];
    this.currentBatch = [];
    
    try {
      this.processing = true;
      await processor(batch);
      this.stats.processedLines += batch.length;
      
      // Emit progress
      this.emit('progress', {
        processed: this.stats.processedLines,
        total: this.stats.totalLines,
        errors: this.stats.errorLines
      });
    } catch (error) {
      this.emit('batch-error', {
        batch: batch.map(e => e.lineNumber),
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Mark batch as errors
      this.stats.errorLines += batch.length;
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Pause processing
   */
  pause(): void {
    this.paused = true;
    this.emit('paused');
  }
  
  /**
   * Resume processing
   */
  resume(): void {
    this.paused = false;
    this.emit('resumed');
  }
  
  /**
   * Get current statistics
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }
}

/**
 * Stream processor specifically for Claude Code JSONL files
 */
export class ClaudeCodeJSONLStream extends JSONLStreamProcessor {
  constructor(options: JSONLStreamOptions = {}) {
    super({
      ...options,
      batchSize: options.batchSize || 50, // Smaller batches for complex data
      maxLineLength: options.maxLineLength || 50 * 1024 * 1024 // 50MB for large messages
    });
  }
  
  /**
   * Process Claude Code JSONL with type validation
   */
  async processClaudeFile(
    filePath: string,
    processor: (entries: any[]) => Promise<void>
  ): Promise<ProcessingStats> {
    return this.processFile(filePath, async (entries) => {
      // Extract and validate Claude Code entries
      const validEntries = entries
        .map(entry => entry.data)
        .filter(data => {
          // Basic validation for Claude Code JSONL structure
          return data && (
            data.type === 'message' ||
            data.type === 'session' ||
            data.type === 'tool_use' ||
            data.type === 'attachment'
          );
        });
      
      if (validEntries.length > 0) {
        await processor(validEntries);
      }
    });
  }
}

/**
 * Helper function to stream process a JSONL file
 */
export async function streamJSONL(
  filePath: string,
  processor: (entries: JSONLEntry[]) => Promise<void>,
  options?: JSONLStreamOptions
): Promise<ProcessingStats> {
  const stream = new JSONLStreamProcessor(options);
  
  // Add default error logging
  stream.on('error-line', (info) => {
    console.warn(`Line ${info.lineNumber} error: ${info.error}`);
  });
  
  stream.on('parse-error', (info) => {
    console.warn(`Parse error at line ${info.lineNumber}: ${info.error}`);
  });
  
  stream.on('batch-error', (info) => {
    console.error(`Batch processing error: ${info.error}`);
  });
  
  return stream.processFile(filePath, processor);
}

/**
 * Helper function to count lines in a JSONL file efficiently
 */
export async function countJSONLLines(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    
    const stream = createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024
    });
    
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
      historySize: 0
    });
    
    rl.on('line', () => {
      count++;
    });
    
    rl.on('close', () => {
      resolve(count);
    });
    
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * Transform function for streaming JSONL transformations
 */
export async function transformJSONL(
  inputPath: string,
  outputPath: string,
  transformer: (entry: any) => any | null,
  options?: JSONLStreamOptions
): Promise<ProcessingStats> {
  const { createWriteStream } = await import('fs');
  const output = createWriteStream(outputPath, { encoding: 'utf8' });
  
  const processor = new JSONLStreamProcessor(options);
  
  return processor.processFile(inputPath, async (entries) => {
    for (const entry of entries) {
      const transformed = transformer(entry.data);
      if (transformed !== null) {
        output.write(JSON.stringify(transformed) + '\n');
      }
    }
  }).finally(() => {
    output.end();
  });
}