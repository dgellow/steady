// Main entry point
export { OpenAPIDocument } from "./openapi-document.ts";
export type { OpenAPIDocumentOptions } from "./openapi-document.ts";

// Core components
export {
  RegistryResponseGenerator,
  SchemaRegistry,
} from "./schema-registry.ts";
export type {
  RegistrySchema,
  SchemaRegistryOptions,
} from "./schema-registry.ts";

// Reference graph
export { RefGraph } from "./ref-graph.ts";

// Types
export type {
  ComplexityMetrics,
  GenerateContext,
  GenerateOptions,
  JsonSchemaDialect,
  JsonSchemaDialects,
  ProcessedSchema,
  Schema,
  SchemaError,
  SchemaMetadata,
  SchemaProcessResult,
  SchemaSource,
  SchemaType,
  SchemaValidationError,
  SchemaValidationResult,
  SchemaWarning,
  ValidatorOptions,
} from "./types.ts";

// Core processing components
export { JsonSchemaProcessor } from "./processor.ts";
