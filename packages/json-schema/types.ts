/**
 * JSON Schema type definitions
 * Based on JSON Schema 2020-12 specification
 */

export interface JsonSchemaDialects {
  "http://json-schema.org/draft-04/schema#": "draft-04";
  "http://json-schema.org/draft-06/schema#": "draft-06";
  "http://json-schema.org/draft-07/schema#": "draft-07";
  "https://json-schema.org/draft/2019-09/schema": "draft-2019-09";
  "https://json-schema.org/draft/2020-12/schema": "draft-2020-12";
  "https://spec.openapis.org/oas/3.1/dialect/base": "openapi-3.1";
}

export type JsonSchemaDialect = keyof JsonSchemaDialects;

export interface BaseSchema {
  // Core keywords
  $schema?: string;
  $id?: string;
  $ref?: string;
  $anchor?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $vocabulary?: Record<string, boolean>;
  $comment?: string;
  $defs?: Record<string, Schema>;

  // Metadata
  title?: string;
  description?: string;
  default?: unknown;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  examples?: unknown[];
}

export interface TypeSchema extends BaseSchema {
  // Type validation
  type?: SchemaType | SchemaType[];
  enum?: unknown[];
  const?: unknown;

  // Numeric validation
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;

  // String validation
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;

  // Array validation
  items?: Schema | Schema[];
  prefixItems?: Schema[];
  unevaluatedItems?: boolean | Schema;
  contains?: Schema;
  minContains?: number;
  maxContains?: number;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;

  // Object validation
  properties?: Record<string, Schema>;
  patternProperties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  unevaluatedProperties?: boolean | Schema;
  propertyNames?: Schema;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, Schema>;

  // Composition
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  not?: Schema;

  // Conditional
  if?: Schema;
  then?: Schema;
  else?: Schema;
}

export interface OpenApiExtensions {
  // OpenAPI specific extensions
  nullable?: boolean; // Deprecated in OpenAPI 3.1
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
  xml?: {
    name?: string;
    namespace?: string;
    prefix?: string;
    attribute?: boolean;
    wrapped?: boolean;
  };
  externalDocs?: {
    url: string;
    description?: string;
  };
  example?: unknown; // Deprecated in favor of examples
}

export type Schema = TypeSchema & OpenApiExtensions;

export type SchemaType =
  | "null"
  | "boolean"
  | "object"
  | "array"
  | "number"
  | "integer"
  | "string";

/**
 * Represents a validation error from JSON Schema validation.
 * Contains rich context for error attribution and debugging.
 */
export interface SchemaValidationError {
  // WHAT went wrong
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
  schema?: unknown;
  data?: unknown;

  // WHERE in source (new)
  sourceLocation?: {
    file: string;
    line: number;
    column: number;
  };

  // WHO is responsible (new)
  attribution?: {
    type: "sdk-error" | "spec-error" | "ambiguous";
    confidence: number; // 0-1
    reasoning: string;
  };

  // HOW to fix (new)
  suggestion?: string;
  example?: string;
  relatedErrors?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
  attribution?: ErrorAttribution;
}

export interface ValidatorOptions {
  dialect?: JsonSchemaDialect;
  strict?: boolean;
  validateFormats?: boolean;
  allowUnknownFormats?: boolean;
  removeAdditional?: boolean | "all" | "failing";
}

// New types for the processor architecture

export interface ProcessedSchema {
  // The validated, normalized root schema
  root: Schema | boolean;

  // Reference resolution results
  refs: {
    resolved: Map<string, Schema | boolean>; // All resolved references
    graph: DependencyGraph; // Reference dependency graph
    cyclic: Set<string>; // Detected circular references
  };

  // Pre-computed indexes for O(1) lookups
  index: {
    byPointer: Map<string, Schema | boolean>; // JSON Pointer → Schema
    byId: Map<string, Schema | boolean>; // $id → Schema
    byAnchor: Map<string, Schema | boolean>; // $anchor → Schema
    definitions: Map<string, Schema | boolean>; // All $defs

    // Type indexes for fast filtering
    byType: Map<SchemaType, Set<string>>; // Type → Pointers
    byFormat: Map<string, Set<string>>; // Format → Pointers
    byKeyword: Map<string, Set<string>>; // Keyword → Pointers
  };

  // Metadata for optimization
  metadata: SchemaMetadata;

  // Source tracking for error messages
  source: SchemaSource;
}

export interface SchemaMetadata {
  totalSchemas: number;
  totalRefs: number;
  maxDepth: number;
  complexity: ComplexityMetrics;
  formats: Set<string>;
  features: Set<string>; // Which JSON Schema features are used
}

export interface ComplexityMetrics {
  score: number; // Overall complexity score
  circularRefs: number; // Number of circular references
  maxNesting: number; // Maximum schema nesting depth
  totalKeywords: number; // Total number of validation keywords
}

export interface SchemaSource {
  metaschema?: Schema;
  baseUri?: string;
  file?: string;
  location?: string; // JSON Pointer in OpenAPI spec
  lineNumbers?: Map<string, LineInfo>; // For rich error messages
}

export interface LineInfo {
  start: number;
  end: number;
  column?: number;
}

export interface DependencyGraph {
  nodes: Set<string>;
  edges: Map<string, Set<string>>;
  cycles: string[][];
}

export interface SchemaProcessResult {
  valid: boolean;
  schema?: ProcessedSchema;
  errors: SchemaError[];
  warnings: SchemaWarning[];
  metadata?: SchemaMetadata; // Only present when processing succeeds
}

export interface SchemaError extends SchemaValidationError {
  type:
    | "schema-invalid"
    | "ref-not-found"
    | "circular-ref"
    | "metaschema-violation";
}

export interface SchemaWarning {
  type: "deprecated-keyword" | "performance-concern" | "compatibility";
  message: string;
  location: string;
  suggestion?: string;
}

export interface ErrorAttribution {
  type: "sdk-error" | "spec-error" | "ambiguous";
  confidence: number;
  reasoning: string;
  primaryError: SchemaValidationError;
  suggestion: string;
  relatedIssues?: string[];
}

export interface GenerateOptions {
  maxDepth?: number;
  seed?: number; // For deterministic generation
  locale?: string; // For localized data
  useExamples?: boolean; // Prefer examples over generated data
  formats?: Record<string, (options: GenerateContext) => unknown>; // Custom format generators
}

export interface GenerateContext {
  depth: number;
  maxDepth: number;
  visited: Set<string>;
  generated: WeakMap<Schema, unknown>;
  random: RandomGenerator;
}

export interface RandomGenerator {
  next(): number; // 0-1
  string(length: number): string;
  pick<T>(array: T[]): T;
}

export interface ValidationContext {
  root: unknown;
  instancePath: string;
  schemaPath: string;
  evaluated: {
    properties: Set<string>;
    items: Set<number>;
  };
  dynamicAnchors?: Map<string, Schema | boolean>;
}
