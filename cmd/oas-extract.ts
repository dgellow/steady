#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { parseArgs } from "@std/cli/parse_args";
import { FastExtractor } from "../packages/oas-extract/src/fast-extractor.ts";
import { SpecTransformer } from "../packages/oas-extract/src/transformer.ts";
import { FastAnalyzer } from "../packages/oas-extract/src/fast-analyzer.ts";
import { GeminiClient } from "../packages/oas-extract/src/llm.ts";
import { SemanticDeduplicator } from "../packages/oas-extract/src/deduplicator.ts";
import { parseSpec } from "../packages/parser/mod.ts";
import { parseStrategy } from "../packages/oas-extract/src/naming-strategies.ts";
import type { OpenAPISpec } from "../packages/oas-extract/src/types.ts";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`
OpenAPI Schema Extractor v${VERSION}

Extract inline schemas from OpenAPI specifications and give them meaningful names using AI.

Usage:
  oas-extract extract <input-file> [options]
  oas-extract --help
  oas-extract --version

Commands:
  extract     Extract inline schemas from an OpenAPI spec
  analyze     Analyze schemas for deduplication without extraction

Options:
  -o, --output <file>       Output file (default: <input>-extracted.json)
  --min-properties <n>      Minimum properties to extract object (default: 2)
  --min-complexity <n>      Minimum complexity score (default: 3)
  --verbose                 Show detailed progress
  --report <file>           Save extraction report to file
  --no-nested              Don't extract nested objects
  --no-array-items         Don't extract array item schemas
  --concurrency <n>        Number of batches to process in parallel (default: 1)
  
Naming Strategy Options:
  --strategy <name>         Naming strategy: deterministic, low-variance, adaptive,
                           multi-sample, decay (default: deterministic)
                           Note: Only 'deterministic' guarantees reproducible builds
  --strategy-opts <json>    Strategy options as JSON (e.g. '{"temperature":0.1}')
  
Deduplication Options:
  --dedup-batch-size <n>    Number of groups to analyze per batch (default: 20)
  --dedup-delay <ms>        Delay between dedup chunks in ms (default: 100)
  --dedup-concurrency <n>   Number of concurrent dedup batches (default: 2)

Examples:
  # Basic extraction
  oas-extract extract api.json

  # Extract with custom output
  oas-extract extract api.yaml -o extracted-api.yaml

  # Extract only complex schemas
  oas-extract extract api.json --min-properties 5 --min-complexity 10

  # Extract with verbose output
  oas-extract extract api.json --verbose
  
  # Extract with deterministic naming (most stable)
  oas-extract extract api.json --strategy deterministic
  
  # Extract with adaptive strategy
  oas-extract extract api.json --strategy adaptive
  
  # Extract with multi-sample strategy (best of 3)
  oas-extract extract api.json --strategy multi-sample --strategy-opts '{"samples":3}'
  
  # Analyze deduplication opportunities only
  oas-extract analyze api.json --verbose
`);
}

async function loadSpec(path: string): Promise<OpenAPISpec> {
  // Use the parser from packages/parser which handles both JSON and YAML
  return await parseSpec(path);
}

async function saveSpec(spec: OpenAPISpec, path: string): Promise<void> {
  let content: string;
  
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    // For YAML output, we'd need a YAML serializer
    // For now, always save as JSON
    console.warn("Note: YAML output not yet supported. Saving as JSON.");
    content = JSON.stringify(spec, null, 2);
  } else {
    content = JSON.stringify(spec, null, 2);
  }
  
  await Deno.writeTextFile(path, content);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: [
      "help",
      "version",
      "verbose",
      "no-nested",
      "no-array-items",
    ],
    string: ["output", "report", "concurrency", "dedup-batch-size", "dedup-delay", "dedup-concurrency", "strategy", "strategy-opts"],
    alias: {
      h: "help",
      v: "version",
      o: "output",
    },
    default: {
      "min-properties": 2,
      "min-complexity": 3,
      "concurrency": 1,
      "dedup-batch-size": 50,
      "dedup-delay": 50,
      "dedup-concurrency": 5,
    },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  if (args.version) {
    console.log(`oas-extract v${VERSION}`);
    Deno.exit(0);
  }

  const command = args._[0];
  if (command !== "extract" && command !== "analyze") {
    console.error("Error: Unknown command or missing command");
    console.error("Run 'oas-extract --help' for usage information");
    Deno.exit(1);
  }

  const inputFile = args._[1] as string;
  if (!inputFile) {
    console.error("Error: Input file is required");
    console.error("Run 'oas-extract --help' for usage information");
    Deno.exit(1);
  }

  // Check if input file exists
  try {
    await Deno.stat(inputFile);
  } catch {
    console.error(`Error: Input file not found: ${inputFile}`);
    Deno.exit(1);
  }

  // Determine output file
  const outputFile = args.output ||
    inputFile.replace(/\.(json|yaml|yml)$/, "-extracted.json");

  try {
    // Load the spec
    console.log(`📄 Loading OpenAPI spec from ${inputFile}...`);
    const spec = await loadSpec(inputFile);
    
    // If analyze command, run deduplication analysis only
    if (command === "analyze") {
      const analyzer = new FastAnalyzer(
        parseInt(args["min-complexity"] as string),
        parseInt(args["min-properties"] as string),
      );
      
      console.log("⚡ Analyzing OpenAPI spec...");
      const contexts = analyzer.analyze(spec);
      console.log(`Found ${contexts.length} schemas`);
      
      if (contexts.length === 0) {
        console.log("No schemas found to analyze.");
        Deno.exit(0);
      }
      
      // Run deduplication analysis
      const llmClient = new GeminiClient();
      llmClient.verbose = args.verbose;
      await llmClient.initialize();
      
      const namingStrategy = parseStrategy(args.strategy as string, args["strategy-opts"] as string);
      
      const deduplicator = new SemanticDeduplicator(
        llmClient,
        parseInt(args["dedup-batch-size"] as string),
        parseInt(args["dedup-delay"] as string),
        parseInt(args["dedup-concurrency"] as string),
        namingStrategy
      );
      
      console.log("\n🧠 Performing semantic deduplication analysis...");
      const result = await deduplicator.deduplicateSchemas(contexts);
      
      // Show detailed results
      const mergedCount = contexts.length - result.mergedContexts.length;
      console.log(`\n📊 Deduplication Analysis Results:`);
      console.log(`   Original schemas: ${contexts.length}`);
      console.log(`   After deduplication: ${result.mergedContexts.length}`);
      console.log(`   Schemas merged: ${mergedCount}`);
      
      // Show merge decisions by confidence
      const byConfidence = {
        HIGH: result.auditTrail.filter(d => d.decision === "MERGE" && d.confidence === "HIGH"),
        MEDIUM: result.auditTrail.filter(d => d.decision === "MERGE" && d.confidence === "MEDIUM"),
        LOW: result.auditTrail.filter(d => d.decision === "MERGE" && d.confidence === "LOW"),
      };
      
      console.log(`\n   Merge decisions by confidence:`);
      console.log(`   - High: ${byConfidence.HIGH.length}`);
      console.log(`   - Medium: ${byConfidence.MEDIUM.length}`);
      console.log(`   - Low: ${byConfidence.LOW.length}`);
      
      if (args.verbose && result.auditTrail.length > 0) {
        console.log("\n🔍 Detailed merge decisions:");
        for (const decision of result.auditTrail.filter(d => d.decision === "MERGE")) {
          console.log(`\n${decision.groupId} (${decision.confidence} confidence):`);
          console.log(`  Concept: ${decision.semanticConcept}`);
          console.log(`  Suggested name: ${decision.suggestedName || "N/A"}`);
          console.log(`  Reasoning: ${decision.reasoning}`);
        }
      }
      
      Deno.exit(0);
    }

    // Parse naming strategy
    const namingStrategy = parseStrategy(args.strategy as string, args["strategy-opts"] as string);
    
    // Create extractor with options
    const extractor = new FastExtractor({
      minProperties: parseInt(args["min-properties"] as string),
      minComplexity: parseInt(args["min-complexity"] as string),
      extractNestedObjects: !args["no-nested"],
      extractArrayItems: !args["no-array-items"],
      verbose: args.verbose,
      concurrency: parseInt(args["concurrency"] as string),
      dedupBatchSize: parseInt(args["dedup-batch-size"] as string),
      dedupDelay: parseInt(args["dedup-delay"] as string),
      dedupConcurrency: parseInt(args["dedup-concurrency"] as string),
      namingStrategy,
    });

    // Extract schemas
    const result = await extractor.extract(spec);

    // Save the transformed spec
    console.log(`💾 Saving extracted spec to ${outputFile}...`);
    await saveSpec(result.spec, outputFile);

    // Save report if requested
    if (args.report) {
      const transformer = new SpecTransformer();
      const reportContent = transformer.generateReport(
        result.spec,
        result.extracted,
      );
      await Deno.writeTextFile(args.report as string, reportContent);
      console.log(`📊 Report saved to ${args.report}`);
    }

    // Print summary
    console.log("\n📊 Extraction Summary:");
    console.log(`   Total schemas found: ${result.report.totalSchemasFound}`);
    console.log(`   Schemas extracted: ${result.report.totalExtracted}`);
    console.log("\n   By type:");
    console.log(
      `   - Request bodies: ${result.report.byLocation.requestBodies}`,
    );
    console.log(`   - Responses: ${result.report.byLocation.responses}`);
    console.log(`   - Parameters: ${result.report.byLocation.parameters}`);
    console.log(`   - Nested objects: ${result.report.byLocation.nested}`);

    console.log(`\n✅ Success! Extracted spec saved to ${outputFile}`);
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : String(error),
    );
    if (args.verbose && error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
