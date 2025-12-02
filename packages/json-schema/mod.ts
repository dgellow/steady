/**
 * JSON Schema - Document-Centric Architecture
 *
 * This package provides a complete JSON Schema processor with:
 * - Document-centric ref resolution (the document IS the root)
 * - Complete ref topology analysis upfront
 * - Lazy schema processing with caching
 * - Response generation with cross-ref support
 * - Validation with cross-ref support
 * - Comprehensive diagnostics with attribution
 */

// Main entry point - document-centric architecture
export { OpenAPIDocument } from "./openapi-document.ts";
export type { OpenAPIDocumentOptions } from "./openapi-document.ts";

// Core components
export { SchemaRegistry, RegistryResponseGenerator, RegistryValidator } from "./schema-registry.ts";
export type { RegistrySchema, SchemaRegistryOptions } from "./schema-registry.ts";

// Reference graph
export { RefGraph } from "./ref-graph.ts";

// Document analysis
export { DocumentAnalyzer, analyzeDocument } from "./document-analyzer.ts";
export type { DocumentAnalyzerConfig } from "./document-analyzer.ts";

// Diagnostics
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticPhase,
  DiagnosticSeverity,
  DiagnosticSummary,
  Attribution,
  AttributionType,
  RelatedDiagnostic,
} from "./diagnostics/types.ts";
export {
  summarizeDiagnostics,
  filterBySeverity,
  groupByCode,
} from "./diagnostics/types.ts";
export {
  getAttribution,
  createAttribution,
  adjustConfidence,
  getAttributionLabel,
} from "./diagnostics/attribution.ts";
export {
  formatDiagnostic,
  formatDiagnosticsGrouped,
  formatSummary,
  formatForResponse,
  formatStartupDiagnostics,
  formatSessionSummary,
} from "./diagnostics/formatter.ts";

// Analyzers
export { RefAnalyzer } from "./analyzers/ref-analyzer.ts";
export type { Analyzer, RefAnalyzerConfig } from "./analyzers/ref-analyzer.ts";
export { SchemaAnalyzer } from "./analyzers/schema-analyzer.ts";
export type { SchemaAnalyzerConfig } from "./analyzers/schema-analyzer.ts";
export { MockAnalyzer } from "./analyzers/mock-analyzer.ts";

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
  SchemaWarning,
  ValidationError,
  ValidationResult,
  ValidatorOptions,
} from "./types.ts";

// Legacy exports for compatibility during migration
// TODO: Remove these after full migration
export { JsonSchemaProcessor } from "./processor.ts";
export { SchemaValidator, type SchemaValidatorOptions } from "./schema-validator.ts";
export { ResponseGenerator } from "./response-generator.ts";
