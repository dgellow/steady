/**
 * Logging Types - Core data model for the Steady logging system
 *
 * Everything flows through one unified structure that captures complete context
 * for any validation issue or diagnostic.
 */

import type { Diagnostic, IssueCategory } from "../diagnostic.ts";

export type { IssueCategory } from "../diagnostic.ts";

/**
 * A validation error with complete context for logging display.
 * All fields required for rich error reporting.
 */
export interface ValidationError {
  // Where
  path: string; // body.email, query.limit
  specPointer: string; // #/components/schemas/User/properties/email

  // What
  keyword: string; // format, type, required, pattern
  message: string; // Human-readable

  // Expected vs Actual
  expected: string; // Human-readable: "email format"
  actual: unknown; // The specific failing value

  // Attribution
  category: IssueCategory;
  attribution: { confidence: number; reasoning: string[] };

  // Fix
  suggestion?: string;
}

/**
 * Result of validating a request
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Base log event
 */
export interface LogEvent {
  id: string;
  timestamp: Date;
  type: "request" | "startup" | "shutdown" | "warning" | "error";
}

/**
 * A logged HTTP request with full context
 */
export interface RequestEvent extends LogEvent {
  type: "request";

  request: {
    method: string;
    path: string;
    pathPattern: string; // /users/{id}
    query: string;
    headers: Headers;
    body?: unknown;
  };

  response: {
    status: number;
    statusText: string;
    timing: number;
    headers: Headers;
    body?: unknown;
  };

  validation: ValidationResult;
}

/**
 * Server startup event
 */
export interface StartupEvent extends LogEvent {
  type: "startup";

  spec: {
    title: string;
    version: string;
    endpointCount: number;
  };

  server: {
    url: string;
    rejectOnSdkError: boolean;
  };

  diagnostics: Diagnostic[];
}

/**
 * Top issue from a session
 */
export interface TopIssue {
  path: string;
  method: string;
  message: string;
  count: number;
  category: IssueCategory;
  attribution: { confidence: number; reasoning: string[] };
}

/**
 * Server shutdown event with session summary
 */
export interface ShutdownEvent extends LogEvent {
  type: "shutdown";

  session: {
    duration: number;
    requestCount: number;
    failedCount: number;
    validityRate: number;
    categoryBreakdown: Partial<Record<IssueCategory, number>>;
  };

  topIssues: TopIssue[];
  coverage?: { tested: number; total: number };
}

/**
 * Warning event
 */
export interface WarningEvent extends LogEvent {
  type: "warning";
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Error event
 */
export interface ErrorEvent extends LogEvent {
  type: "error";
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Log level controlling output verbosity
 */
export type LogLevel = "summary" | "details" | "full";

/**
 * Output format
 */
export type LogFormat = "text" | "json";

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  level: LogLevel;
  format: LogFormat;
  color: boolean;
  logBodies: boolean;
}

/**
 * Stored request for TUI - includes all context for display
 */
export interface StoredRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  pathPattern: string;
  query: string;
  headers: Headers;
  body?: unknown;
  statusCode: number;
  statusText: string;
  responseHeaders?: Headers;
  responseBody?: unknown;
  timing: number;
  validation: ValidationResult;
}
