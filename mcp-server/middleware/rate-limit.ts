/**
 * Rate limiting middleware for MCP server
 * Prevents abuse and ensures fair usage
 */

import { getMCPConfig } from '../../config/index.js';
import { getLogger } from '../../utils/logger.js';
import { RateLimitError } from '../../utils/errors.js';

const logger = getLogger('mcp-rate-limit');

interface RateLimitEntry {
  count: number;
  windowStart: number;
  blocked: boolean;
  blockUntil?: number;
}

/**
 * Token bucket algorithm for smooth rate limiting
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  
  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  /**
   * Try to consume tokens
   */
  consume(tokens: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }
  
  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
  
  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
  
  /**
   * Get time until next token available (ms)
   */
  getWaitTime(): number {
    if (this.tokens >= 1) return 0;
    
    const tokensNeeded = 1 - this.tokens;
    const secondsToWait = tokensNeeded / this.refillRate;
    return Math.ceil(secondsToWait * 1000);
  }
}

/**
 * Rate limiter with multiple strategies
 */
export class RateLimiter {
  private clients = new Map<string, RateLimitEntry>();
  private buckets = new Map<string, TokenBucket>();
  private config = getMCPConfig();
  private cleanupInterval?: NodeJS.Timeout;
  
  constructor() {
    // Start cleanup timer
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean every minute
  }
  
  /**
   * Check if request should be rate limited
   */
  async checkLimit(
    clientId: string,
    options: {
      weight?: number;      // Request weight (for complex queries)
      strategy?: 'sliding' | 'token';
      customLimit?: number;
    } = {}
  ): Promise<{ allowed: boolean; retryAfter?: number; remaining?: number }> {
    const strategy = options.strategy || 'token';
    const weight = options.weight || 1;
    
    if (strategy === 'token') {
      return this.checkTokenBucket(clientId, weight);
    } else {
      return this.checkSlidingWindow(clientId, options.customLimit);
    }
  }
  
  /**
   * Token bucket rate limiting (smooth)
   */
  private checkTokenBucket(
    clientId: string,
    weight: number
  ): { allowed: boolean; retryAfter?: number; remaining?: number } {
    // Get or create bucket
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      // Capacity = requests per minute, refill rate = requests per second
      const capacity = this.config.rateLimitPerMinute;
      const refillRate = capacity / 60;
      bucket = new TokenBucket(capacity, refillRate);
      this.buckets.set(clientId, bucket);
    }
    
    const allowed = bucket.consume(weight);
    const remaining = Math.floor(bucket.getTokens());
    
    if (!allowed) {
      const retryAfter = bucket.getWaitTime();
      logger.warn(`Rate limit exceeded for client ${clientId}`, {
        weight,
        remaining,
        retryAfter
      });
      
      return { allowed: false, retryAfter, remaining: 0 };
    }
    
    return { allowed: true, remaining };
  }
  
  /**
   * Sliding window rate limiting (strict)
   */
  private checkSlidingWindow(
    clientId: string,
    customLimit?: number
  ): { allowed: boolean; retryAfter?: number; remaining?: number } {
    const now = Date.now();
    const windowSize = 60000; // 1 minute window
    const limit = customLimit || this.config.rateLimitPerMinute;
    
    let entry = this.clients.get(clientId);
    
    // Initialize or reset if window expired
    if (!entry || now - entry.windowStart > windowSize) {
      entry = {
        count: 0,
        windowStart: now,
        blocked: false
      };
      this.clients.set(clientId, entry);
    }
    
    // Check if blocked
    if (entry.blocked && entry.blockUntil && now < entry.blockUntil) {
      const retryAfter = Math.ceil((entry.blockUntil - now) / 1000);
      return { allowed: false, retryAfter, remaining: 0 };
    }
    
    // Check limit
    if (entry.count >= limit) {
      entry.blocked = true;
      entry.blockUntil = entry.windowStart + windowSize;
      
      const retryAfter = Math.ceil((entry.blockUntil - now) / 1000);
      logger.warn(`Rate limit exceeded for client ${clientId}`, {
        count: entry.count,
        limit,
        retryAfter
      });
      
      return { allowed: false, retryAfter, remaining: 0 };
    }
    
    // Increment counter
    entry.count++;
    const remaining = limit - entry.count;
    
    return { allowed: true, remaining };
  }
  
  /**
   * Reset rate limit for a client
   */
  reset(clientId: string): void {
    this.clients.delete(clientId);
    this.buckets.delete(clientId);
    logger.info(`Rate limit reset for client ${clientId}`);
  }
  
  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const windowSize = 60000;
    
    // Clean sliding window entries
    for (const [clientId, entry] of this.clients) {
      if (now - entry.windowStart > windowSize * 2) {
        this.clients.delete(clientId);
      }
    }
    
    // Token buckets don't need cleanup (they self-manage)
    
    logger.debug(`Rate limiter cleanup: ${this.clients.size} clients, ${this.buckets.size} buckets`);
  }
  
  /**
   * Get rate limit status for a client
   */
  getStatus(clientId: string): {
    limited: boolean;
    requests: number;
    remaining: number;
    resetAt?: Date;
  } {
    const bucket = this.buckets.get(clientId);
    if (bucket) {
      const remaining = Math.floor(bucket.getTokens());
      return {
        limited: remaining === 0,
        requests: this.config.rateLimitPerMinute - remaining,
        remaining
      };
    }
    
    const entry = this.clients.get(clientId);
    if (!entry) {
      return {
        limited: false,
        requests: 0,
        remaining: this.config.rateLimitPerMinute
      };
    }
    
    return {
      limited: entry.blocked || false,
      requests: entry.count,
      remaining: Math.max(0, this.config.rateLimitPerMinute - entry.count),
      resetAt: new Date(entry.windowStart + 60000)
    };
  }
  
  /**
   * Shutdown cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Query complexity analyzer for adaptive rate limiting
 */
export class QueryComplexityAnalyzer {
  /**
   * Calculate query complexity score
   */
  static analyze(sql: string): number {
    let complexity = 1;
    const normalizedSql = sql.toUpperCase();
    
    // Base complexity by operation
    if (normalizedSql.includes('JOIN')) {
      complexity += normalizedSql.split('JOIN').length - 1;
    }
    
    if (normalizedSql.includes('UNION')) {
      complexity += 2;
    }
    
    if (normalizedSql.includes('GROUP BY')) {
      complexity += 1;
    }
    
    if (normalizedSql.includes('ORDER BY')) {
      complexity += 0.5;
    }
    
    if (normalizedSql.includes('DISTINCT')) {
      complexity += 0.5;
    }
    
    // Subqueries
    const subqueryCount = (normalizedSql.match(/\(SELECT/g) || []).length;
    complexity += subqueryCount * 2;
    
    // Wildcards in WHERE clause
    if (normalizedSql.includes('LIKE') && normalizedSql.includes('%')) {
      complexity += 1;
    }
    
    // No LIMIT clause (potentially large result set)
    if (!normalizedSql.includes('LIMIT')) {
      complexity += 2;
    }
    
    // Functions
    const functions = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'SUBSTR', 'LENGTH'];
    for (const func of functions) {
      if (normalizedSql.includes(func)) {
        complexity += 0.5;
      }
    }
    
    return Math.min(complexity, 10); // Cap at 10
  }
  
  /**
   * Check if query is too complex
   */
  static isTooComplex(sql: string, maxComplexity: number = 5): boolean {
    return this.analyze(sql) > maxComplexity;
  }
  
  /**
   * Get query restrictions based on complexity
   */
  static getRestrictions(sql: string): {
    maxRows: number;
    timeout: number;
    cacheable: boolean;
  } {
    const complexity = this.analyze(sql);
    
    return {
      maxRows: Math.max(100, 1000 / complexity),
      timeout: Math.min(30000, 5000 * complexity),
      cacheable: complexity < 3
    };
  }
}

/**
 * Middleware for MCP server rate limiting
 */
export function createRateLimitMiddleware(limiter?: RateLimiter) {
  const rateLimiter = limiter || new RateLimiter();
  
  return async function rateLimitMiddleware(
    request: any,
    context: { clientId?: string }
  ): Promise<void> {
    // Extract client ID (from context, headers, or IP)
    const clientId = context.clientId || 'default';
    
    // Calculate request weight based on complexity
    let weight = 1;
    if (request.params?.sql) {
      weight = Math.ceil(QueryComplexityAnalyzer.analyze(request.params.sql) / 2);
    }
    
    // Check rate limit
    const result = await rateLimiter.checkLimit(clientId, { weight });
    
    if (!result.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded. Please retry after ${result.retryAfter} seconds`,
        {
          clientId,
          retryAfter: result.retryAfter,
          limit: getMCPConfig().rateLimitPerMinute
        }
      );
    }
    
    // Add rate limit headers to context
    context.rateLimit = {
      remaining: result.remaining || 0,
      limit: getMCPConfig().rateLimitPerMinute,
      reset: new Date(Date.now() + 60000)
    };
  };
}

// Global rate limiter instance
let globalRateLimiter: RateLimiter | null = null;

/**
 * Get or create global rate limiter
 */
export function getRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter();
  }
  return globalRateLimiter;
}

// Cleanup on exit
process.on('SIGINT', () => {
  if (globalRateLimiter) {
    globalRateLimiter.destroy();
  }
});

process.on('SIGTERM', () => {
  if (globalRateLimiter) {
    globalRateLimiter.destroy();
  }
});