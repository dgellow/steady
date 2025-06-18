// Essential OpenAPI 3.0 types for MVP
// Not exhaustive - just what we need for the prototype

export interface OpenAPISpec {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  paths: PathsObject;
  components?: ComponentsObject;
}

export interface InfoObject {
  title: string;
  version: string;
  description?: string;
}

export interface ServerObject {
  url: string;
  description?: string;
}

export interface PathsObject {
  [path: string]: PathItemObject;
}

export interface PathItemObject {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
}

export interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: ResponsesObject;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: SchemaObject;
}

export interface RequestBodyObject {
  content: ContentObject;
  required?: boolean;
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject;
}

export interface ResponseObject {
  description?: string;
  content?: ContentObject;
}

export interface ContentObject {
  [mediaType: string]: MediaTypeObject;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: unknown;
  examples?: { [name: string]: ExampleObject };
}

export interface ExampleObject {
  value?: unknown;
  externalValue?: string;
}

export interface ComponentsObject {
  schemas?: { [name: string]: SchemaObject };
  responses?: { [name: string]: ResponseObject };
  parameters?: { [name: string]: ParameterObject };
  examples?: { [name: string]: ExampleObject };
  requestBodies?: { [name: string]: RequestBodyObject };
}

export interface SchemaObject {
  // Reference
  $ref?: string;

  // Basic validation
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null";
  format?: string;

  // String validation
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Number validation
  minimum?: number;
  maximum?: number;

  // Array validation
  items?: SchemaObject;
  minItems?: number;
  maxItems?: number;

  // Object validation
  properties?: { [name: string]: SchemaObject };
  required?: string[];
  additionalProperties?: boolean | SchemaObject;

  // Composition
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  not?: SchemaObject;

  // Metadata
  title?: string;
  description?: string;
  default?: unknown;
  example?: unknown;

  // OpenAPI specific
  nullable?: boolean;
  discriminator?: DiscriminatorObject;
  xml?: XMLObject;
  externalDocs?: ExternalDocsObject;
  deprecated?: boolean;
}

export interface DiscriminatorObject {
  propertyName: string;
  mapping?: { [value: string]: string };
}

export interface XMLObject {
  name?: string;
  namespace?: string;
  prefix?: string;
  attribute?: boolean;
  wrapped?: boolean;
}

export interface ExternalDocsObject {
  url: string;
  description?: string;
}

// Internal types for Steady

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

export type LogLevel = "summary" | "details" | "full";

export interface ServerConfig {
  port: number;
  host: string;
  mode: "strict" | "relaxed";
  verbose: boolean;
  logLevel: LogLevel;
  logBodies?: boolean;
  showValidation?: boolean;
}

export interface ErrorContext {
  // Where
  specFile?: string;
  specLine?: number;
  httpPath?: string;
  httpMethod?: string;
  schemaPath?: string[]; // JSON path like ['components', 'schemas', 'User']

  // What
  errorType: "parse" | "validate" | "match" | "generate" | "reference";
  expected?: unknown;
  actual?: unknown;

  // Why
  reason: string;

  // How to fix
  suggestion?: string;
  examples?: string[];
}

// Validation types
export interface ValidationError {
  path: string; // e.g., "body.email" or "query.limit"
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}
