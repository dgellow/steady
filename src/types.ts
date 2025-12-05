// Internal types for Steady (non-OpenAPI types)

import type {
  OperationObject,
  ResponseObject,
  SchemaObject,
} from "@steady/parser";
import type { LogLevel } from "@steady/shared";

export interface ResolvedOperation {
  method: string;
  path: string;
  operation: OperationObject;
  resolvedResponses: Map<string, ResolvedResponse>;
}

export interface ResolvedResponse {
  statusCode: string;
  response: ResponseObject;
  mediaTypes: Map<string, ResolvedMediaType>;
}

export interface ResolvedMediaType {
  mediaType: string;
  schema?: ResolvedSchema;
  example?: unknown;
  examples?: { [name: string]: unknown };
}

export interface ResolvedSchema extends Omit<SchemaObject, "$ref"> {
  // Schema with all $refs resolved
  resolvedFrom?: string; // Track where this was resolved from
}

export interface ValidatorConfig {
  /**
   * Enable strict oneOf validation per JSON Schema semantics.
   * When false (default), oneOf passes if ANY variant matches (union-like).
   * When true, oneOf requires EXACTLY one variant to match.
   */
  strictOneOf?: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  mode: "strict" | "relaxed";
  verbose: boolean;
  logLevel: LogLevel;
  logBodies?: boolean;
  showValidation?: boolean;
  interactive?: boolean;
  validator?: ValidatorConfig;
}

// Validation types
/**
 * Represents a single validation issue found during request validation.
 * This is a simple data structure for reporting validation problems,
 * not an Error class that gets thrown.
 */
export interface ValidationIssue {
  path: string; // e.g., "body.email" or "query.limit"
  message: string;
  expected?: unknown;
  actual?: unknown;
}

// Re-export types that are used in multiple places
export type {
  ComponentsObject,
  ContentObject,
  ExampleObject,
  MediaTypeObject,
  OpenAPISpec,
  OperationObject,
  ParameterObject,
  PathItemObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from "@steady/parser";

import type { ReferenceObject } from "@steady/parser";

/**
 * Type guard to check if a value is a ReferenceObject
 */
export function isReference(value: unknown): value is ReferenceObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as ReferenceObject).$ref === "string"
  );
}
