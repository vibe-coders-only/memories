/**
 * OpenTelemetry tracing setup for distributed tracing and performance monitoring
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { 
  BasicTracerProvider, 
  ConsoleSpanExporter, 
  SimpleSpanProcessor,
  BatchSpanProcessor
} from '@opentelemetry/sdk-trace-base';
import { 
  JaegerExporter 
} from '@opentelemetry/exporter-jaeger';
import {
  PrometheusExporter
} from '@opentelemetry/exporter-prometheus';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { trace, context, SpanStatusCode, SpanKind, Span } from '@opentelemetry/api';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('telemetry');

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  jaegerEndpoint?: string;
  prometheusPort?: number;
  consoleExport?: boolean;
  samplingRate?: number;
}

/**
 * Get telemetry configuration from environment
 */
function getTelemetryConfig(): TelemetryConfig {
  return {
    enabled: process.env.OTEL_ENABLED === 'true',
    serviceName: process.env.OTEL_SERVICE_NAME || 'mem-sqlite',
    serviceVersion: process.env.OTEL_SERVICE_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    jaegerEndpoint: process.env.OTEL_EXPORTER_JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    prometheusPort: parseInt(process.env.OTEL_PROMETHEUS_PORT || '9090'),
    consoleExport: process.env.OTEL_CONSOLE_EXPORT === 'true',
    samplingRate: parseFloat(process.env.OTEL_SAMPLING_RATE || '1.0')
  };
}

/**
 * Initialize OpenTelemetry SDK
 */
export function initializeTelemetry(config?: Partial<TelemetryConfig>): NodeSDK | null {
  const telemetryConfig = { ...getTelemetryConfig(), ...config };
  
  if (!telemetryConfig.enabled) {
    logger.info('Telemetry is disabled');
    return null;
  }
  
  logger.info('Initializing OpenTelemetry', {
    service: telemetryConfig.serviceName,
    version: telemetryConfig.serviceVersion,
    environment: telemetryConfig.environment
  });
  
  // Create resource
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: telemetryConfig.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: telemetryConfig.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: telemetryConfig.environment,
    })
  );
  
  // Create exporters
  const spanExporters = [];
  
  if (telemetryConfig.consoleExport) {
    spanExporters.push(new ConsoleSpanExporter());
  }
  
  if (telemetryConfig.jaegerEndpoint) {
    spanExporters.push(new JaegerExporter({
      endpoint: telemetryConfig.jaegerEndpoint,
    }));
  }
  
  // Create tracer provider
  const tracerProvider = new BasicTracerProvider({
    resource,
    sampler: {
      shouldSample: () => ({
        decision: Math.random() < telemetryConfig.samplingRate! ? 1 : 0,
        attributes: {}
      }),
      toString: () => 'ProbabilitySampler'
    }
  });
  
  // Add span processors
  spanExporters.forEach(exporter => {
    if (exporter instanceof ConsoleSpanExporter) {
      tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    } else {
      tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter));
    }
  });
  
  // Register tracer provider
  tracerProvider.register();
  
  // Initialize metrics if Prometheus is configured
  if (telemetryConfig.prometheusPort) {
    const prometheusExporter = new PrometheusExporter({
      port: telemetryConfig.prometheusPort,
    }, () => {
      logger.info(`Prometheus metrics available at http://localhost:${telemetryConfig.prometheusPort}/metrics`);
    });
    
    const meterProvider = new MeterProvider({
      resource,
      readers: [prometheusExporter],
    });
  }
  
  // Create SDK
  const sdk = new NodeSDK({
    resource,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Disable fs instrumentation (too noisy)
        },
      }),
    ],
  });
  
  // Start SDK
  sdk.start();
  
  logger.info('OpenTelemetry initialized successfully');
  
  return sdk;
}

/**
 * Tracer instance for manual instrumentation
 */
export class Tracer {
  private tracer = trace.getTracer('mem-sqlite');
  
  /**
   * Start a new span
   */
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      parent?: Span;
    }
  ): Span {
    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    }, options?.parent ? trace.setSpan(context.active(), options.parent) : undefined);
    
    return span;
  }
  
  /**
   * Execute function within a span context
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): Promise<T> {
    const span = this.startSpan(name, options);
    
    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => fn(span)
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Execute synchronous function within a span context
   */
  withSpanSync<T>(
    name: string,
    fn: (span: Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): T {
    const span = this.startSpan(name, options);
    
    try {
      const result = context.with(
        trace.setSpan(context.active(), span),
        () => fn(span)
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Add event to current span
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }
  
  /**
   * Set attributes on current span
   */
  setAttributes(attributes: Record<string, any>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
}

/**
 * Database operation tracing
 */
export class DatabaseTracer extends Tracer {
  /**
   * Trace a database query
   */
  async traceQuery<T>(
    operation: string,
    query: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `db.${operation}`,
      async (span) => {
        span.setAttributes({
          'db.system': 'sqlite',
          'db.operation': operation,
          'db.statement': query.substring(0, 500), // Truncate long queries
        });
        
        const startTime = Date.now();
        const result = await fn();
        const duration = Date.now() - startTime;
        
        span.setAttributes({
          'db.duration_ms': duration,
        });
        
        return result;
      },
      { kind: SpanKind.CLIENT }
    );
  }
  
  /**
   * Trace a database transaction
   */
  async traceTransaction<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `db.transaction.${name}`,
      async (span) => {
        span.setAttributes({
          'db.system': 'sqlite',
          'db.operation': 'transaction',
        });
        
        return await fn();
      },
      { kind: SpanKind.CLIENT }
    );
  }
}

/**
 * HTTP request tracing
 */
export class HTTPTracer extends Tracer {
  /**
   * Trace an HTTP request
   */
  async traceRequest<T>(
    method: string,
    url: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `http.${method.toLowerCase()}`,
      async (span) => {
        span.setAttributes({
          'http.method': method,
          'http.url': url,
          'http.scheme': new URL(url).protocol.replace(':', ''),
          'http.host': new URL(url).host,
          'http.target': new URL(url).pathname,
        });
        
        const startTime = Date.now();
        
        try {
          const result = await fn();
          const duration = Date.now() - startTime;
          
          span.setAttributes({
            'http.status_code': 200,
            'http.duration_ms': duration,
          });
          
          return result;
        } catch (error: any) {
          span.setAttributes({
            'http.status_code': error.statusCode || 500,
          });
          throw error;
        }
      },
      { kind: SpanKind.CLIENT }
    );
  }
}

/**
 * File operation tracing
 */
export class FileTracer extends Tracer {
  /**
   * Trace a file read operation
   */
  async traceRead<T>(
    path: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      'file.read',
      async (span) => {
        span.setAttributes({
          'file.path': path,
          'file.operation': 'read',
        });
        
        const startTime = Date.now();
        const result = await fn();
        const duration = Date.now() - startTime;
        
        span.setAttributes({
          'file.duration_ms': duration,
        });
        
        return result;
      },
      { kind: SpanKind.INTERNAL }
    );
  }
  
  /**
   * Trace a file write operation
   */
  async traceWrite<T>(
    path: string,
    size: number,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      'file.write',
      async (span) => {
        span.setAttributes({
          'file.path': path,
          'file.operation': 'write',
          'file.size': size,
        });
        
        const startTime = Date.now();
        const result = await fn();
        const duration = Date.now() - startTime;
        
        span.setAttributes({
          'file.duration_ms': duration,
          'file.throughput_mb_s': (size / 1024 / 1024) / (duration / 1000),
        });
        
        return result;
      },
      { kind: SpanKind.INTERNAL }
    );
  }
}

/**
 * Custom metrics collector
 */
export class MetricsCollector {
  private meter = trace.getTracer('mem-sqlite-metrics');
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  /**
   * Increment a counter
   */
  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    // Add as span event
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent('metric.counter', {
        'metric.name': name,
        'metric.value': value,
        ...labels
      });
    }
  }
  
  /**
   * Record a histogram value
   */
  record(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
    
    // Add as span event
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent('metric.histogram', {
        'metric.name': name,
        'metric.value': value,
        ...labels
      });
    }
  }
  
  /**
   * Get metrics summary
   */
  getSummary(): Record<string, any> {
    const summary: Record<string, any> = {
      counters: {},
      histograms: {}
    };
    
    // Summarize counters
    for (const [key, value] of this.counters) {
      summary.counters[key] = value;
    }
    
    // Summarize histograms
    for (const [key, values] of this.histograms) {
      if (values.length > 0) {
        values.sort((a, b) => a - b);
        summary.histograms[key] = {
          count: values.length,
          min: values[0],
          max: values[values.length - 1],
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          p50: values[Math.floor(values.length * 0.5)],
          p95: values[Math.floor(values.length * 0.95)],
          p99: values[Math.floor(values.length * 0.99)]
        };
      }
    }
    
    return summary;
  }
  
  /**
   * Reset metrics
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
  
  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    
    return `${name}{${labelStr}}`;
  }
}

// Global instances
let globalTracer: Tracer | null = null;
let globalDbTracer: DatabaseTracer | null = null;
let globalHttpTracer: HTTPTracer | null = null;
let globalFileTracer: FileTracer | null = null;
let globalMetrics: MetricsCollector | null = null;

/**
 * Get global tracer instances
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

export function getDatabaseTracer(): DatabaseTracer {
  if (!globalDbTracer) {
    globalDbTracer = new DatabaseTracer();
  }
  return globalDbTracer;
}

export function getHTTPTracer(): HTTPTracer {
  if (!globalHttpTracer) {
    globalHttpTracer = new HTTPTracer();
  }
  return globalHttpTracer;
}

export function getFileTracer(): FileTracer {
  if (!globalFileTracer) {
    globalFileTracer = new FileTracer();
  }
  return globalFileTracer;
}

export function getMetrics(): MetricsCollector {
  if (!globalMetrics) {
    globalMetrics = new MetricsCollector();
  }
  return globalMetrics;
}

// Auto-initialize if enabled
if (process.env.OTEL_ENABLED === 'true') {
  initializeTelemetry();
}