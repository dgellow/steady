// Internal types for Steady (non-OpenAPI types)

import type {
  OperationObject,
  ResponseObject,
  SchemaObject,
} from "@steady/openapi";
import type { LogLevel } from "./logging/mod.ts";

export { VERSION } from "./version.ts";

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
  /** Override array query param format */
  QUERY_ARRAY_FORMAT: "X-Steady-Query-Array-Format",
  /** Override object query param format */
  QUERY_OBJECT_FORMAT: "X-Steady-Query-Object-Format",
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
 * How array query parameters are serialized.
 * Maps to OpenAPI style/explode combinations.
 *
 * - 'auto': read from OpenAPI spec's style/explode (default)
 * - 'repeat': colors=red&colors=green (style=form, explode=true)
 * - 'comma': colors=red,green,blue (style=form, explode=false)
 * - 'space': colors=red%20green%20blue (style=spaceDelimited)
 * - 'pipe': colors=red|green|blue (style=pipeDelimited)
 * - 'brackets': colors[]=red&colors[]=green (PHP/Rails style, non-standard)
 */
export type QueryArrayFormat =
  | "auto"
  | "repeat"
  | "comma"
  | "space"
  | "pipe"
  | "brackets";

/** All valid array format values */
export const VALID_ARRAY_FORMATS: readonly QueryArrayFormat[] = [
  "auto",
  "repeat",
  "comma",
  "space",
  "pipe",
  "brackets",
] as const;

/** Set for O(1) lookup in type guard */
const VALID_ARRAY_FORMATS_SET: ReadonlySet<string> = new Set(
  VALID_ARRAY_FORMATS,
);

/**
 * How object query parameters are serialized.
 * Maps to OpenAPI style/explode combinations.
 *
 * - 'auto': read from OpenAPI spec's style/explode (default)
 * - 'flat': role=admin&firstName=Alex (style=form, explode=true)
 * - 'flat-comma': id=role,admin,firstName,Alex (style=form, explode=false)
 * - 'brackets': id[role]=admin&id[firstName]=Alex (style=deepObject)
 * - 'dots': id.role=admin&id.firstName=Alex (non-standard, SDK compat)
 */
export type QueryObjectFormat =
  | "auto"
  | "flat"
  | "flat-comma"
  | "brackets"
  | "dots";

/** All valid object format values */
export const VALID_OBJECT_FORMATS: readonly QueryObjectFormat[] = [
  "auto",
  "flat",
  "flat-comma",
  "brackets",
  "dots",
] as const;

/** Set for O(1) lookup in type guard */
const VALID_OBJECT_FORMATS_SET: ReadonlySet<string> = new Set(
  VALID_OBJECT_FORMATS,
);

/** Type guard for valid array format strings */
export function isValidArrayFormat(
  value: string | null,
): value is QueryArrayFormat {
  return value !== null && VALID_ARRAY_FORMATS_SET.has(value);
}

/** Type guard for valid object format strings */
export function isValidObjectFormat(
  value: string | null,
): value is QueryObjectFormat {
  return value !== null && VALID_OBJECT_FORMATS_SET.has(value);
}

export interface ValidatorConfig {
  /**
   * Enable strict oneOf validation per JSON Schema semantics.
   * When false (default), oneOf passes if ANY variant matches (union-like).
   * When true, oneOf requires EXACTLY one variant to match.
   */
  strictOneOf?: boolean;

  /**
   * How to parse array query parameters.
   * Default: 'auto' (read from OpenAPI spec)
   */
  queryArrayFormat?: QueryArrayFormat;

  /**
   * How to parse object query parameters.
   * Default: 'auto' (read from OpenAPI spec)
   */
  queryObjectFormat?: QueryObjectFormat;
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
