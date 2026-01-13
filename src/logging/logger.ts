/**
 * Logger Interface - Core abstraction for all logging implementations
 */

import type {
  LoggerOptions,
  LogLevel,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

/**
 * Logger interface that all implementations must satisfy
 */
export interface Logger {
  /**
   * Log a request event with full context
   */
  request(event: RequestEvent): void;

  /**
   * Log server startup with spec info and diagnostics
   */
  startup(event: StartupEvent): void;

  /**
   * Log server shutdown with session summary
   */
  shutdown(event: ShutdownEvent): void;

  /**
   * Log a warning message
   */
  warning(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Base logger class with common functionality
 */
export abstract class BaseLogger implements Logger {
  protected readonly level: LogLevel;
  protected readonly useColor: boolean;
  protected readonly logBodies: boolean;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.level = options.level ?? "summary";
    this.useColor = options.color ?? true;
    this.logBodies = options.logBodies ?? false;
  }

  abstract request(event: RequestEvent): void;
  abstract startup(event: StartupEvent): void;
  abstract shutdown(event: ShutdownEvent): void;
  abstract warning(message: string, context?: Record<string, unknown>): void;
  abstract error(message: string, context?: Record<string, unknown>): void;

  protected showDetails(): boolean {
    return this.level === "details" || this.level === "full";
  }

  protected showFull(): boolean {
    return this.level === "full";
  }

  protected shouldShowBodies(): boolean {
    return this.logBodies || this.level === "full";
  }
}

export type { LoggerOptions, LogLevel };
