import { FastAnalyzer } from "./fast-analyzer.ts";
import { GeminiClient } from "./llm.ts";
import { SchemaNamer } from "./namer.ts";
import { SpecTransformer } from "./transformer.ts";
import { SemanticDeduplicator } from "./deduplicator.ts";
import type {
  ExtractedSchema,
  ExtractionOptions,
  ExtractionReport,
  ExtractionResult,
  LLMResponse,
  OpenAPISpec,
} from "./types.ts";

export class FastExtractor {
  private analyzer: FastAnalyzer;
  private llmClient: GeminiClient;
  private namer: SchemaNamer;
  private transformer: SpecTransformer;
  private deduplicator: SemanticDeduplicator;
  private options: ExtractionOptions;

  constructor(options: ExtractionOptions = {}) {
    this.options = options;
    this.analyzer = new FastAnalyzer(
      options.minComplexity,
      options.minProperties,
    );
    this.llmClient = new GeminiClient();
    this.namer = new SchemaNamer();
    this.transformer = new SpecTransformer();
    this.llmClient.verbose = options.verbose || false;
    this.deduplicator = new SemanticDeduplicator(
      this.llmClient,
      options.dedupBatchSize,
      options.dedupDelay,
      options.dedupConcurrency,
      options.namingStrategy, // Will default to deterministic in deduplicator
    );
  }

  async extract(spec: OpenAPISpec): Promise<ExtractionResult> {
    const startTime = performance.now();

    // Initialize LLM client
    await this.llmClient.initialize();

    // Step 1: Fast analysis
    if (this.options.verbose) {
      console.log("⚡ Fast-analyzing OpenAPI spec...");
    }
    const contexts = this.analyzer.analyze(spec);

    if (this.options.verbose) {
      console.log(
        `Found ${contexts.length} schemas in ${
          (performance.now() - startTime).toFixed(0)
        }ms`,
      );
    }

    if (contexts.length === 0) {
      return this.emptyResult(spec);
    }

    // Step 2: Semantic deduplication
    if (this.options.verbose) {
      console.log("🧠 Performing semantic deduplication...");
    }

    // Collect existing schema names from the spec
    const existingSchemaNames = Object.keys(spec.components?.schemas || {});

    const deduplicationResult = await this.deduplicator.deduplicateSchemas(
      contexts,
      existingSchemaNames,
    );
    const deduplicatedContexts = deduplicationResult.mergedContexts;

    const reduction = contexts.length - deduplicatedContexts.length;
    if (this.options.verbose) {
      console.log(
        `Reduced ${contexts.length} → ${deduplicatedContexts.length} schemas (${reduction} merged)`,
      );
    }

    // Fail if too many groups failed analysis
    if (deduplicationResult.failedGroups.length > 0) {
      const failureRate = deduplicationResult.failedGroups.length /
        (deduplicationResult.failedGroups.length +
          deduplicationResult.auditTrail.length);
      if (failureRate > 0.5) {
        throw new Error(
          `Deduplication failed: ${deduplicationResult.failedGroups.length} groups could not be analyzed (${
            Math.round(failureRate * 100)
          }% failure rate)`,
        );
      }
    }

    // Step 3: Filter to only schemas worth extracting (those that were merged)
    const worthyContexts = deduplicatedContexts.filter((context) => {
      // Only extract schemas that were merged (have semantic value)
      return !!context.extractedName;
    });

    if (this.options.verbose) {
      const filtered = deduplicatedContexts.length - worthyContexts.length;
      console.log(
        `Extracting ${worthyContexts.length} schemas (${filtered} single-use schemas skipped)`,
      );
    }

    // Step 4: Apply names (no additional LLM calls needed since deduplication provides names)
    const llmResponses: LLMResponse[] = []; // Empty since deduplication already provides semantic names
    const extractedSchemas = this.namer.applyLLMSuggestions(
      worthyContexts,
      llmResponses,
    );

    // Step 5: Transform spec
    if (this.options.verbose) {
      console.log("🔄 Transforming spec...");
    }
    const transformedSpec = this.transformer.transform(spec, extractedSchemas);

    // Generate report
    const report = this.generateReport(extractedSchemas);

    const totalTime = performance.now() - startTime;

    // Production metrics logging
    const metrics = {
      timestamp: new Date().toISOString(),
      totalTimeMs: Math.round(totalTime),
      schemasFound: contexts.length,
      schemasExtracted: extractedSchemas.length,
      schemasDeduped: contexts.length - deduplicatedContexts.length,
      batchesProcessed: 0, // No LLM batches needed since deduplication provides names
      concurrency: this.options.concurrency || 1,
    };

    if (this.options.verbose) {
      console.log(`\n📊 Production Metrics:`, JSON.stringify(metrics, null, 2));
    }

    console.log(
      `✅ Extraction complete in ${
        (totalTime / 1000).toFixed(1)
      }s! Extracted ${extractedSchemas.length} schemas`,
    );

    return {
      spec: transformedSpec,
      extracted: extractedSchemas,
      report,
    };
  }

  private emptyResult(spec: OpenAPISpec): ExtractionResult {
    return {
      spec,
      extracted: [],
      report: {
        totalSchemasFound: 0,
        totalExtracted: 0,
        byResource: {},
        byLocation: {
          requestBodies: 0,
          responses: 0,
          parameters: 0,
          nested: 0,
        },
      },
    };
  }

  private generateReport(
    extractedSchemas: ExtractedSchema[],
  ): ExtractionReport {
    const byResource: Record<string, number> = {};
    const byLocation = {
      requestBodies: 0,
      responses: 0,
      parameters: 0,
      nested: 0,
    };

    for (const schema of extractedSchemas) {
      const resource = schema.context.resourceName || "general";
      byResource[resource] = (byResource[resource] || 0) + 1;

      if (schema.context.location.includes("requestBody")) {
        byLocation.requestBodies++;
      } else if (schema.context.location.includes("responses")) {
        byLocation.responses++;
      } else if (schema.context.location.includes("parameters")) {
        byLocation.parameters++;
      }

      if (schema.context.parentContext) {
        byLocation.nested++;
      }
    }

    return {
      totalSchemasFound: extractedSchemas.length,
      totalExtracted: extractedSchemas.length,
      byResource,
      byLocation,
    };
  }
}
