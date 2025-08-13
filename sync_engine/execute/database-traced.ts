/**
 * Database operations with OpenTelemetry tracing
 */

import { executeParsedEntries as originalExecuteParsedEntries, ExecuteResult } from './database.js';
import { ParsedEntry } from '../claude_code/transform/index.js';
import { getDatabaseTracer, getMetrics } from '../../telemetry/tracing.js';

const dbTracer = getDatabaseTracer();
const metrics = getMetrics();

/**
 * Execute parsed entries with tracing
 */
export async function executeParsedEntries(parsedEntries: ParsedEntry[]): Promise<ExecuteResult> {
  return dbTracer.traceTransaction('execute_parsed_entries', async () => {
    const startTime = Date.now();
    
    // Record metrics
    metrics.increment('db.operations.started', 1, { operation: 'execute_batch' });
    metrics.record('db.batch.size', parsedEntries.length);
    
    try {
      const result = await Promise.resolve(originalExecuteParsedEntries(parsedEntries));
      
      // Record success metrics
      const duration = Date.now() - startTime;
      metrics.increment('db.operations.completed', 1, { operation: 'execute_batch', status: 'success' });
      metrics.record('db.operations.duration_ms', duration, { operation: 'execute_batch' });
      metrics.record('db.messages.inserted', result.messagesInserted);
      metrics.record('db.messages.updated', result.messagesUpdated);
      
      // Add trace attributes
      dbTracer.setAttributes({
        'db.batch.size': parsedEntries.length,
        'db.messages.inserted': result.messagesInserted,
        'db.messages.updated': result.messagesUpdated,
        'db.errors.count': result.errors.length,
        'db.duration_ms': duration
      });
      
      return result;
    } catch (error) {
      // Record error metrics
      metrics.increment('db.operations.completed', 1, { operation: 'execute_batch', status: 'error' });
      metrics.increment('db.errors', 1, { operation: 'execute_batch' });
      
      throw error;
    }
  });
}