// Shared types for logging and utilities

export type LogLevel = "summary" | "details" | "full";

/**
 * Validation result structure for logging purposes.
 * This is a simplified interface for the logger - not the full JSON Schema validation result.
 */
export interface LogValidationResult {
  valid: boolean;
  errors: Array<
    { path: string; message: string; expected?: unknown; actual?: unknown }
  >;
  warnings: Array<
    { path: string; message: string; expected?: unknown; actual?: unknown }
  >;
}

/**
 * Stored request data for interactive loggers.
 * Used by SimpleLogger and InkSimpleLogger to track request/response cycles.
 */
export interface StoredRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  query: string;
  headers: Headers;
  body?: unknown;
  statusCode: number;
  statusText: string;
  responseHeaders?: Headers;
  responseBody?: unknown;
  timing: number;
  validation?: LogValidationResult;
}
