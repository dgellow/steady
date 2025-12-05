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

// Document analysis
export { analyzeDocument, DocumentAnalyzer } from "./document-analyzer.ts";
export type { DocumentAnalyzerConfig } from "./document-analyzer.ts";

// Diagnostics
export type {
  Attribution,
  AttributionType,
  Diagnostic,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticPhase,
  DiagnosticSeverity,
  DiagnosticSummary,
  RelatedDiagnostic,
} from "./diagnostics/types.ts";
export {
  filterBySeverity,
  groupByCode,
  summarizeDiagnostics,
} from "./diagnostics/types.ts";
export {
  adjustConfidence,
  createAttribution,
  getAttribution,
  getAttributionLabel,
} from "./diagnostics/attribution.ts";
export {
  formatDiagnostic,
  formatDiagnosticsGrouped,
  formatForResponse,
  formatSessionSummary,
  formatStartupDiagnostics,
  formatSummary,
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
