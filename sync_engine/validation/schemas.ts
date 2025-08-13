/**
 * JSON Schema validation for Claude Code JSONL entries
 * Ensures data integrity before database insertion
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Schema definitions for Claude Code message types
 */
export const MessageSchemas = {
  // Base message schema
  baseMessage: {
    type: 'object',
    required: ['id', 'type', 'timestamp'],
    properties: {
      id: { type: 'string', minLength: 1 },
      type: { type: 'string', enum: ['message', 'summary', 'user', 'assistant'] },
      timestamp: { type: 'string', format: 'date-time' },
      isSidechain: { type: 'boolean' }
    }
  },
  
  // Summary message
  summaryMessage: {
    type: 'object',
    required: ['projectName'],
    properties: {
      projectName: { type: 'string' },
      activeFile: { type: 'string' }
    }
  },
  
  // User message
  userMessage: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      type: { type: 'string' },
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            text: { type: 'string' },
            url: { type: 'string' },
            mimeType: { type: 'string' },
            title: { type: 'string' },
            filePath: { type: 'string' }
          }
        }
      }
    }
  },
  
  // Assistant message
  assistantMessage: {
    type: 'object',
    required: ['text'],
    properties: {
      role: { type: 'string' },
      text: { type: 'string' },
      model: { type: 'string' },
      toolUses: {
        type: 'array',
        items: {
          type: 'object',
          required: ['toolId', 'toolName', 'parameters'],
          properties: {
            toolId: { type: 'string' },
            toolName: { type: 'string' },
            parameters: { type: 'object' }
          }
        }
      }
    }
  },
  
  // Tool use result
  toolUseResult: {
    type: 'object',
    required: ['toolUseId'],
    properties: {
      toolUseId: { type: 'string' },
      output: { type: 'string' },
      outputMimeType: { type: 'string' },
      error: { type: 'string' },
      errorType: { type: 'string' }
    }
  },
  
  // Environment info
  envInfo: {
    type: 'object',
    properties: {
      workingDirectory: { type: 'string' },
      isGitRepo: { type: 'boolean' },
      platform: { type: 'string' },
      osVersion: { type: 'string' },
      todaysDate: { type: 'string' }
    }
  }
};

/**
 * Validator class for Claude Code messages
 */
export class MessageValidator {
  private errors: string[] = [];
  private warnings: string[] = [];
  
  /**
   * Validate a message against its schema
   */
  validate(message: any): ValidationResult {
    this.errors = [];
    this.warnings = [];
    
    // Check base requirements
    if (!message || typeof message !== 'object') {
      this.errors.push('Message must be an object');
      return this.getResult();
    }
    
    if (!message.type) {
      this.errors.push('Message must have a type field');
      return this.getResult();
    }
    
    // Validate base message
    this.validateBase(message);
    
    // Validate specific message type
    switch (message.type) {
      case 'summary':
        this.validateSummary(message);
        break;
      case 'user':
        this.validateUser(message);
        break;
      case 'assistant':
        this.validateAssistant(message);
        break;
      default:
        this.warnings.push(`Unknown message type: ${message.type}`);
    }
    
    return this.getResult();
  }
  
  /**
   * Validate base message fields
   */
  private validateBase(message: any): void {
    // Required fields
    if (!message.id || typeof message.id !== 'string') {
      this.errors.push('Message must have a valid id (string)');
    }
    
    if (!message.timestamp) {
      this.errors.push('Message must have a timestamp');
    } else if (!this.isValidTimestamp(message.timestamp)) {
      this.warnings.push(`Invalid timestamp format: ${message.timestamp}`);
    }
    
    // Optional fields
    if (message.isSidechain !== undefined && typeof message.isSidechain !== 'boolean') {
      this.warnings.push('isSidechain should be a boolean');
    }
  }
  
  /**
   * Validate summary message
   */
  private validateSummary(message: any): void {
    if (!message.projectName || typeof message.projectName !== 'string') {
      this.errors.push('Summary message must have a projectName (string)');
    }
    
    if (message.activeFile && typeof message.activeFile !== 'string') {
      this.warnings.push('activeFile should be a string');
    }
  }
  
  /**
   * Validate user message
   */
  private validateUser(message: any): void {
    if (!message.text || typeof message.text !== 'string') {
      this.errors.push('User message must have text (string)');
    }
    
    if (message.attachments) {
      if (!Array.isArray(message.attachments)) {
        this.errors.push('Attachments must be an array');
      } else {
        message.attachments.forEach((att: any, i: number) => {
          this.validateAttachment(att, i);
        });
      }
    }
  }
  
  /**
   * Validate assistant message
   */
  private validateAssistant(message: any): void {
    if (!message.text || typeof message.text !== 'string') {
      this.errors.push('Assistant message must have text (string)');
    }
    
    if (message.toolUses) {
      if (!Array.isArray(message.toolUses)) {
        this.errors.push('toolUses must be an array');
      } else {
        message.toolUses.forEach((tool: any, i: number) => {
          this.validateToolUse(tool, i);
        });
      }
    }
    
    if (message.model && typeof message.model !== 'string') {
      this.warnings.push('model should be a string');
    }
  }
  
  /**
   * Validate attachment
   */
  private validateAttachment(attachment: any, index: number): void {
    if (!attachment || typeof attachment !== 'object') {
      this.errors.push(`Attachment ${index} must be an object`);
      return;
    }
    
    if (!attachment.type) {
      this.errors.push(`Attachment ${index} must have a type`);
    }
    
    // Validate based on type
    if (attachment.type === 'text' && !attachment.text) {
      this.errors.push(`Text attachment ${index} must have text field`);
    }
    
    if (attachment.type === 'file' && !attachment.filePath) {
      this.warnings.push(`File attachment ${index} should have filePath`);
    }
  }
  
  /**
   * Validate tool use
   */
  private validateToolUse(tool: any, index: number): void {
    if (!tool || typeof tool !== 'object') {
      this.errors.push(`Tool use ${index} must be an object`);
      return;
    }
    
    if (!tool.toolId || typeof tool.toolId !== 'string') {
      this.errors.push(`Tool use ${index} must have toolId (string)`);
    }
    
    if (!tool.toolName || typeof tool.toolName !== 'string') {
      this.errors.push(`Tool use ${index} must have toolName (string)`);
    }
    
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      this.errors.push(`Tool use ${index} must have parameters (object)`);
    }
  }
  
  /**
   * Check if timestamp is valid
   */
  private isValidTimestamp(timestamp: any): boolean {
    if (typeof timestamp !== 'string') return false;
    
    // Check ISO 8601 format
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  }
  
  /**
   * Get validation result
   */
  private getResult(): ValidationResult {
    return {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings]
    };
  }
}

/**
 * Batch validator for multiple messages
 */
export class BatchValidator {
  private validator = new MessageValidator();
  private stats = {
    total: 0,
    valid: 0,
    invalid: 0,
    warnings: 0
  };
  
  /**
   * Validate a batch of messages
   */
  validateBatch(messages: any[]): {
    results: ValidationResult[];
    stats: typeof this.stats;
    summary: string;
  } {
    const results: ValidationResult[] = [];
    this.stats = { total: 0, valid: 0, invalid: 0, warnings: 0 };
    
    for (const message of messages) {
      const result = this.validator.validate(message);
      results.push(result);
      
      this.stats.total++;
      if (result.valid) {
        this.stats.valid++;
      } else {
        this.stats.invalid++;
      }
      if (result.warnings.length > 0) {
        this.stats.warnings++;
      }
    }
    
    return {
      results,
      stats: this.stats,
      summary: this.getSummary()
    };
  }
  
  /**
   * Get validation summary
   */
  private getSummary(): string {
    const percent = this.stats.total > 0 
      ? Math.round((this.stats.valid / this.stats.total) * 100)
      : 0;
      
    return `Validated ${this.stats.total} messages: ${this.stats.valid} valid (${percent}%), ` +
           `${this.stats.invalid} invalid, ${this.stats.warnings} with warnings`;
  }
}

/**
 * Sanitizer to clean and fix common issues
 */
export class MessageSanitizer {
  /**
   * Sanitize a message to fix common issues
   */
  sanitize(message: any): any {
    if (!message || typeof message !== 'object') {
      return message;
    }
    
    const sanitized = { ...message };
    
    // Fix missing timestamp
    if (!sanitized.timestamp) {
      sanitized.timestamp = new Date().toISOString();
    }
    
    // Fix timestamp format
    if (typeof sanitized.timestamp === 'number') {
      sanitized.timestamp = new Date(sanitized.timestamp).toISOString();
    }
    
    // Ensure id exists
    if (!sanitized.id) {
      sanitized.id = this.generateId();
    }
    
    // Clean text fields
    if (sanitized.text && typeof sanitized.text === 'string') {
      sanitized.text = sanitized.text.trim();
    }
    
    // Fix boolean fields
    if (sanitized.isSidechain !== undefined) {
      sanitized.isSidechain = Boolean(sanitized.isSidechain);
    }
    
    // Sanitize arrays
    if (sanitized.attachments && !Array.isArray(sanitized.attachments)) {
      sanitized.attachments = [];
    }
    
    if (sanitized.toolUses && !Array.isArray(sanitized.toolUses)) {
      sanitized.toolUses = [];
    }
    
    return sanitized;
  }
  
  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Validate and sanitize messages before processing
 */
export function validateAndSanitize(
  messages: any[],
  options: {
    throwOnError?: boolean;
    sanitize?: boolean;
    logWarnings?: boolean;
  } = {}
): any[] {
  const validator = new BatchValidator();
  const sanitizer = new MessageSanitizer();
  
  // Sanitize first if requested
  const toValidate = options.sanitize 
    ? messages.map(msg => sanitizer.sanitize(msg))
    : messages;
  
  // Validate
  const validation = validator.validateBatch(toValidate);
  
  // Log warnings if requested
  if (options.logWarnings) {
    validation.results.forEach((result, i) => {
      if (result.warnings.length > 0) {
        console.warn(`Message ${i} warnings:`, result.warnings);
      }
    });
  }
  
  // Handle errors
  if (validation.stats.invalid > 0) {
    const errorMessages = validation.results
      .filter(r => !r.valid)
      .flatMap(r => r.errors);
    
    if (options.throwOnError) {
      throw new Error(`Validation failed: ${errorMessages.join(', ')}`);
    }
    
    console.error('Validation errors:', errorMessages);
  }
  
  // Return sanitized messages or filter out invalid ones
  if (options.throwOnError) {
    return toValidate;
  }
  
  return toValidate.filter((_, i) => validation.results[i].valid);
}