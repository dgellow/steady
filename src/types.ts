// Internal types for Steady (non-OpenAPI types)

import type {
  OpenAPISpec,
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

export interface ReferenceGraph {
  nodes: Map<string, SchemaObject>;
  edges: Map<string, Set<string>>;
  cycles: Set<string>[];
}

export interface GenerationContext {
  depth: number;
  maxDepth: number;
  visitedRefs: Set<string>;
  generatedObjects: WeakMap<SchemaObject, unknown>;
  spec: OpenAPISpec;
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
}

// Validation types
export interface ValidationError {
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
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  SchemaObject,
} from "@steady/parser";
