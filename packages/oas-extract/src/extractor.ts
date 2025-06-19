import { SchemaAnalyzer } from "./analyzer.ts";
import { SchemaChunker } from "./chunker.ts";
import { GeminiClient } from "./llm.ts";
import { SchemaNamer } from "./namer.ts";
import { SpecTransformer } from "./transformer.ts";
import type {
  ExtractionOptions,
  ExtractionResult,
  LLMResponse,
  OpenAPISpec,
} from "./types.ts";

export class OpenAPIExtractor {
  private analyzer: SchemaAnalyzer;
  private chunker: SchemaChunker;
  private llmClient: GeminiClient;
  private namer: SchemaNamer;
  private transformer: SpecTransformer;
  private options: ExtractionOptions;

  constructor(options: ExtractionOptions = {}) {
    this.options = options;
    this.analyzer = new SchemaAnalyzer(options);
    this.chunker = new SchemaChunker();
    this.llmClient = new GeminiClient();
    this.namer = new SchemaNamer();
    this.transformer = new SpecTransformer();
  }

  async extract(spec: OpenAPISpec): Promise<ExtractionResult> {
    console.log("🔍 Analyzing OpenAPI spec...");

    // Initialize LLM client
    await this.llmClient.initialize();

    // Step 1: Analyze spec and find inline schemas
    const contexts = this.analyzer.analyze(spec);
    console.log(`Found ${contexts.length} inline schemas`);

    if (contexts.length === 0) {
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

    // Step 2: Create batches for LLM processing
    console.log("📦 Creating batches for LLM processing...");
    const batches = this.chunker.createBatches(contexts);
    console.log(`Created ${batches.length} batches`);

    // Step 3: Process batches with LLM
    console.log("🤖 Generating names with Gemini Flash...");
    const llmResponses: LLMResponse[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (this.options.verbose) {
        console.log(
          `Processing batch ${
            i + 1
          }/${batches.length} (${batch.schemas.length} schemas)`,
        );
      }

      try {
        const response = await this.llmClient.generateNames(batch);
        llmResponses.push(response);
      } catch (error) {
        console.error(`Failed to process batch ${batch.id}:`, error);
        // Continue with other batches
      }

      // Add a small delay to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Step 4: Apply names and resolve conflicts
    console.log("✏️  Applying names and resolving conflicts...");
    const extractedSchemas = this.namer.applyLLMSuggestions(
      contexts,
      llmResponses,
    );

    // Step 5: Transform the spec (unless dry run)
    let transformedSpec = spec;
    if (!this.options.dryRun) {
      console.log("🔄 Transforming spec with extracted schemas...");
      transformedSpec = this.transformer.transform(spec, extractedSchemas);
    }

    // Step 6: Generate report
    const report = this.generateReport(extractedSchemas);

    console.log(
      `✅ Extraction complete! Extracted ${extractedSchemas.length} schemas`,
    );

    return {
      spec: transformedSpec,
      extracted: extractedSchemas,
      report,
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
      // Count by resource
      const resource = schema.context.resourceName || "general";
      byResource[resource] = (byResource[resource] || 0) + 1;

      // Count by location type
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
