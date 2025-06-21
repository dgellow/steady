// Import OpenAPI types from the parser package (single source of truth)
import type {
  OpenAPISpec,
  SchemaObject,
  PathItemObject,
  OperationObject,
  ParameterObject,
  ResponseObject,
  MediaTypeObject,
  ExampleObject,
  ComponentsObject,
  InfoObject,
  RequestBodyObject,
  ResponsesObject,
  DiscriminatorObject,
  XMLObject,
  ServerObject,
  ServerVariableObject,
  ExternalDocsObject,
  ReferenceObject,
  TagObject,
  HeaderObject,
  EncodingObject,
  LinkObject,
  CallbackObject,
  SecurityRequirement,
} from "../../parser/openapi.ts";

// Re-export types for consumers
export type {
  OpenAPISpec,
  SchemaObject,
  ParameterObject,
  ResponseObject,
  MediaTypeObject,
  ExampleObject,
  ComponentsObject,
  InfoObject,
  RequestBodyObject,
  ResponsesObject,
  DiscriminatorObject,
  XMLObject,
  ReferenceObject,
  TagObject,
  HeaderObject,
  EncodingObject,
  LinkObject,
  CallbackObject,
  SecurityRequirement,
};

// Type aliases for convenience
export type PathItem = PathItemObject;
export type Operation = OperationObject;
export type Server = ServerObject;
export type ServerVariable = ServerVariableObject;
export type ExternalDocumentationObject = ExternalDocsObject;
export type Tag = TagObject;

// Extraction specific types
export interface SchemaContext {
  path: string;
  method?: string;
  statusCode?: string;
  location: string;
  schema: SchemaObject;
  parentContext?: string;
  operationId?: string;
  resourceName?: string;
  extractedName?: string; // For deduplication
  mergedFrom?: number; // Number of schemas merged into this one
}

export interface ExtractedSchema {
  name: string;
  schema: SchemaObject;
  context: SchemaContext;
  originalPath: string;
}

import type { NamingStrategy } from "./naming-strategies.ts";

export interface ExtractionOptions {
  minProperties?: number;
  minComplexity?: number;
  extractArrayItems?: boolean;
  extractNestedObjects?: boolean;
  verbose?: boolean;
  concurrency?: number;
  dedupBatchSize?: number;
  dedupDelay?: number;
  dedupConcurrency?: number;
  namingStrategy?: NamingStrategy;
}

export interface ExtractionResult {
  spec: OpenAPISpec;
  extracted: ExtractedSchema[];
  report: ExtractionReport;
}

export interface ExtractionReport {
  totalSchemasFound: number;
  totalExtracted: number;
  byResource: Record<string, number>;
  byLocation: {
    requestBodies: number;
    responses: number;
    parameters: number;
    nested: number;
  };
}

// LLM related types
export interface LLMBatch {
  id: string;
  schemas: SchemaContext[];
  domainHints: string[];
  resourceGroup: string;
}

export interface LLMResponse {
  batchId: string;
  suggestions: Record<string, { name: string; reasoning: string }>;
}