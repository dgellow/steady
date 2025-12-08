// Internal types for Steady (non-OpenAPI types)

import type {
  OperationObject,
  ResponseObject,
  SchemaObject,
} from "@steady/openapi";
import type { LogLevel } from "./logging/mod.ts";

// Import version from deno.json
import denoConfig from "../deno.json" with { type: "json" };

/** Package version from deno.json */
export const VERSION = denoConfig.version;

/** Default server port */
export const DEFAULT_PORT = 3000;

/**
 * X-Steady-* header names used by the mock server.
 * Request headers can be sent by clients to override behavior.
 * Response headers are informational and sent back to clients.
 */
export const HEADERS = {
  // Request headers (clients can send these to override behavior)
  /** Override validation mode: "strict" | "relaxed" */
  MODE: "X-Steady-Mode",
  /** Override array size for generated responses (sets both min and max) */
  ARRAY_SIZE: "X-Steady-Array-Size",
  /** Override minimum array size for generated responses */
  ARRAY_MIN: "X-Steady-Array-Min",
  /** Override maximum array size for generated responses */
  ARRAY_MAX: "X-Steady-Array-Max",
  /** Override seed for deterministic generation (-1 for random) */
  SEED: "X-Steady-Seed",

  // Response headers (informational)
  /** The OpenAPI path pattern that matched the request */
  MATCHED_PATH: "X-Steady-Matched-Path",
  /** How the response body was generated: "generated" | "none" */
  EXAMPLE_SOURCE: "X-Steady-Example-Source",
  /** Indicates a serialization error occurred (set to "true") */
  SERIALIZATION_ERROR: "X-Steady-Serialization-Error",
} as const;

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

/**
 * How array query parameters are serialized
 * - 'repeat': colors=red&colors=green (explode=true, default)
 * - 'comma': colors=red,green,blue (explode=false)
 * - 'brackets': colors[]=red&colors[]=green (PHP/Rails style)
 */
export type QueryArrayFormat = "repeat" | "comma" | "brackets";

/**
 * How nested object query parameters are serialized
 * - 'none': flat keys, no nesting support (default)
 * - 'brackets': user[name]=sam&user[age]=123 (deepObject style)
 */
export type QueryNestedFormat = "none" | "brackets";

export interface ValidatorConfig {
  /**
   * Enable strict oneOf validation per JSON Schema semantics.
   * When false (default), oneOf passes if ANY variant matches (union-like).
   * When true, oneOf requires EXACTLY one variant to match.
   */
  strictOneOf?: boolean;

  /**
   * How to parse array query parameters.
   * Default: 'repeat' (colors=red&colors=green)
   */
  queryArrayFormat?: QueryArrayFormat;

  /**
   * How to parse nested object query parameters.
   * Default: 'none' (flat keys)
   */
  queryNestedFormat?: QueryNestedFormat;
}

export interface GeneratorConfig {
  /**
   * Minimum array size for generated responses.
   * Default: 1
   */
  arrayMin?: number;

  /**
   * Maximum array size for generated responses.
   * Default: 1
   */
  arrayMax?: number;

  /**
   * Seed for deterministic random generation.
   * If not set, uses random seed.
   */
  seed?: number;
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
  generator?: GeneratorConfig;
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
} from "@steady/openapi";

import type { ReferenceObject } from "@steady/openapi";

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
