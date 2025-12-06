export { FastExtractor } from "./src/fast-extractor.ts";
export { FastAnalyzer } from "./src/fast-analyzer.ts";
export { SchemaChunker } from "./src/chunker.ts";
export { GeminiClient } from "./src/llm.ts";
export { SchemaNamer } from "./src/namer.ts";
export { SpecTransformer } from "./src/transformer.ts";
export { SemanticDeduplicator } from "./src/deduplicator.ts";
export type { DeduplicationDecision } from "./src/deduplicator.ts";
export { parseStrategy } from "./src/naming-strategies.ts";
export type { NamingStrategy } from "./src/naming-strategies.ts";
export {
  compareStrategies,
  evaluateStability,
  formatStabilityReport,
} from "./src/evaluate.ts";
export type { NameVariation, StabilityReport } from "./src/evaluate.ts";

export type {
  ExtractedSchema,
  ExtractionOptions,
  ExtractionReport,
  ExtractionResult,
  LLMBatch,
  LLMResponse,
  OpenAPISpec,
  SchemaContext,
} from "./src/types.ts";
