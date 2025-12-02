/**
 * JSON Schema validation utilities for OpenAPI
 *
 * This package provides a complete JSON Schema processor with:
 * - Schema validation against metaschema
 * - Enterprise-scale reference resolution
 * - Fast runtime validation
 * - Mock data generation
 * - Error attribution (SDK vs spec)
 */

// Legacy validator removed - use JsonSchemaProcessor instead

// New processor architecture
export { JsonSchemaProcessor } from "./processor.ts";
export {
  SchemaValidator,
  type SchemaValidatorOptions,
} from "./schema-validator.ts";
export { ResponseGenerator } from "./response-generator.ts";

// Types
export type {
  ComplexityMetrics,
  ErrorAttribution,
  GenerateContext,
  GenerateOptions,
  // Core types
  JsonSchemaDialect,
  JsonSchemaDialects,
  // New processor types
  ProcessedSchema,
  Schema,
  SchemaError,
  SchemaMetadata,
  SchemaProcessResult,
  SchemaSource,
  SchemaType,
  SchemaWarning,
  ValidationError,
  ValidationResult,
  ValidatorOptions,
} from "./types.ts";
