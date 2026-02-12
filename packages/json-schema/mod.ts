// Main entry point
export { OpenAPIDocument } from "./openapi-document.ts";
export type { OpenAPIDocumentOptions } from "./openapi-document.ts";

// Core components
export {
  RegistryResponseGenerator,
  RegistryValidator,
  SchemaRegistry,
} from "./schema-registry.ts";
export type {
  RegistrySchema,
  RegistryValidatorOptions,
  SchemaRegistryOptions,
} from "./schema-registry.ts";

// Reference graph
export { RefGraph } from "./ref-graph.ts";

// Types
export type {
  ComplexityMetrics,
  ErrorAttribution,
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
  ValidationResult,
  ValidatorOptions,
} from "./types.ts";
// Backwards compatibility aliases (deprecated)
export type { SchemaValidationError as ValidationError } from "./types.ts";

// Core processing components
export { JsonSchemaProcessor } from "./processor.ts";
export {
  SchemaValidator,
  type SchemaValidatorOptions,
} from "./schema-validator.ts";
