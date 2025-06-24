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
export { SchemaValidator } from "./schema-validator.ts";
export { ResponseGenerator } from "./response-generator.ts";

// Types
export type {
  // Core types
  JsonSchemaDialect,
  JsonSchemaDialects,
  Schema,
  SchemaType,
  ValidationError,
  ValidationResult,
  ValidatorOptions,
  
  // New processor types
  ProcessedSchema,
  SchemaProcessResult,
  SchemaError,
  SchemaWarning,
  SchemaMetadata,
  ComplexityMetrics,
  SchemaSource,
  ErrorAttribution,
  GenerateOptions,
  GenerateContext,
} from "./types.ts";
