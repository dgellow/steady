/**
 * Logging Types - Core data model for the Steady logging system
 *
 * Everything flows through one unified structure that captures complete context
 * for any validation issue or diagnostic.
 */

import type { Diagnostic, IssueCategory } from "../diagnostic.ts";

export type { IssueCategory } from "../diagnostic.ts";

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
    bodySize?: number;
    responseWarning?: string;
  };

  diagnostics: Diagnostic[];
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

  /** Path to spec file, used in "run `steady validate <spec>`" hints. */
  specPath?: string;

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
  coverage?: { tested: number; total: number; untestedEndpoints: string[] };
  generationWarnings?: string[];
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
