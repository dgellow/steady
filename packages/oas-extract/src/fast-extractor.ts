import { FastAnalyzer } from "./fast-analyzer.ts";
import { SchemaChunker } from "./chunker.ts";
import { GeminiClient } from "./llm.ts";
import { SchemaNamer } from "./namer.ts";
import { SpecTransformer } from "./transformer.ts";
import { SemanticDeduplicator } from "./deduplicator.ts";
import type {
  ExtractionOptions,
  ExtractionResult,
  LLMBatch,
  LLMResponse,
  OpenAPISpec,
} from "./types.ts";

export class FastExtractor {
  private analyzer: FastAnalyzer;
  private chunker: SchemaChunker;
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
    this.chunker = new SchemaChunker(50, 6000); // Larger batches for efficiency
    this.llmClient = new GeminiClient();
    this.namer = new SchemaNamer();
    this.transformer = new SpecTransformer();
    this.deduplicator = new SemanticDeduplicator(this.llmClient);
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

    // Step 2: Semantic deduplication (optional)
    let deduplicatedContexts = contexts;

    if (this.options.enableDeduplication) {
      if (this.options.verbose) {
        console.log("🧠 Performing semantic deduplication...");
      }
      const deduplicationResult = await this.deduplicator.deduplicateSchemas(
        contexts,
      );
      deduplicatedContexts = deduplicationResult.mergedContexts;

      const reduction = contexts.length - deduplicatedContexts.length;
      if (this.options.verbose) {
        console.log(
          `Reduced ${contexts.length} → ${deduplicatedContexts.length} schemas (${reduction} merged)`,
        );
      }
    }

    // Step 3: Create batches
    const batches = this.chunker.createBatches(deduplicatedContexts);
    if (this.options.verbose) {
      console.log(`📦 Created ${batches.length} batches`);
    }

    // Step 3: Process batches in parallel with rate limiting
    const llmResponses = await this.processLLMBatches(batches);

    // Step 4: Apply names
    const extractedSchemas = this.namer.applyLLMSuggestions(
      deduplicatedContexts,
      llmResponses,
    );

    // Step 5: Transform spec
    let transformedSpec = spec;
    if (!this.options.dryRun) {
      if (this.options.verbose) {
        console.log("🔄 Transforming spec...");
      }
      transformedSpec = this.transformer.transform(spec, extractedSchemas);
    }

    // Generate report
    const report = this.generateReport(extractedSchemas);

    const totalTime = performance.now() - startTime;
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

  private async processLLMBatches(batches: LLMBatch[]): Promise<LLMResponse[]> {
    if (this.options.verbose) {
      console.log("🚀 Processing with Gemini Flash (parallel)...");
    }

    const responses: LLMResponse[] = [];
    const concurrency = this.options.concurrency || 1;

    if (this.options.verbose) {
      console.log(`Using concurrency: ${concurrency}`);
    }

    // Process in chunks to avoid rate limiting
    for (let i = 0; i < batches.length; i += concurrency) {
      const chunk = batches.slice(i, i + concurrency);
      const chunkPromises = chunk.map(async (batch) => {
        try {
          // Add delay to respect rate limits and ensure quality responses
          await new Promise((resolve) => setTimeout(resolve, 5000)); // 5s between requests
          return await this.llmClient.generateNames(batch);
        } catch (error) {
          console.error(`Batch ${batch.id} failed:`, error);
          // Return empty response to continue processing
          return { batchId: batch.id, suggestions: {} };
        }
      });

      const chunkResponses = await Promise.all(chunkPromises);
      responses.push(...chunkResponses);

      if (this.options.verbose && i + concurrency < batches.length) {
        const progress = Math.min(i + concurrency, batches.length);
        console.log(`Progress: ${progress}/${batches.length} batches`);
      }
    }

    return responses;
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

  private generateReport(extractedSchemas: any[]): any {
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
