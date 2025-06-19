#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { parseArgs } from "@std/cli/parse_args";
import { FastExtractor } from "../packages/oas-extract/src/fast-extractor.ts";
import { SpecTransformer } from "../packages/oas-extract/src/transformer.ts";
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
  extract    Extract inline schemas from an OpenAPI spec

Options:
  -o, --output <file>       Output file (default: <input>-extracted.json)
  --min-properties <n>      Minimum properties to extract object (default: 2)
  --min-complexity <n>      Minimum complexity score (default: 3)
  --dry-run                 Show what would be extracted without modifying
  --verbose                 Show detailed progress
  --report <file>           Save extraction report to file
  --no-nested              Don't extract nested objects
  --no-array-items         Don't extract array item schemas
  --enable-deduplication   Enable semantic deduplication (experimental)
  --concurrency <n>        Number of batches to process in parallel (default: 1)

Examples:
  # Basic extraction
  oas-extract extract api.json

  # Extract with custom output
  oas-extract extract api.yaml -o extracted-api.yaml

  # Dry run to see what would be extracted
  oas-extract extract api.json --dry-run --verbose

  # Extract only complex schemas
  oas-extract extract api.json --min-properties 5 --min-complexity 10

  # Extract with semantic deduplication
  oas-extract extract api.json --enable-deduplication --verbose
`);
}

async function loadSpec(path: string): Promise<OpenAPISpec> {
  const content = await Deno.readTextFile(path);

  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    // For YAML support, we'd need to import a YAML parser
    // For now, we'll just support JSON
    throw new Error(
      "YAML support not yet implemented. Please use JSON format.",
    );
  }

  return JSON.parse(content);
}

async function saveSpec(spec: OpenAPISpec, path: string): Promise<void> {
  const content = JSON.stringify(spec, null, 2);
  await Deno.writeTextFile(path, content);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: [
      "help",
      "version",
      "dry-run",
      "verbose",
      "no-nested",
      "no-array-items",
      "enable-deduplication",
    ],
    string: ["output", "report", "concurrency"],
    alias: {
      h: "help",
      v: "version",
      o: "output",
    },
    default: {
      "min-properties": 2,
      "min-complexity": 3,
      "concurrency": 1,
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
  if (command !== "extract") {
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

    // Create extractor with options
    const extractor = new FastExtractor({
      minProperties: parseInt(args["min-properties"] as string),
      minComplexity: parseInt(args["min-complexity"] as string),
      extractNestedObjects: !args["no-nested"],
      extractArrayItems: !args["no-array-items"],
      verbose: args.verbose,
      dryRun: args["dry-run"],
      enableDeduplication: args["enable-deduplication"],
      concurrency: parseInt(args["concurrency"] as string),
    });

    // Extract schemas
    const result = await extractor.extract(spec);

    // Save the transformed spec
    if (!args["dry-run"]) {
      console.log(`💾 Saving extracted spec to ${outputFile}...`);
      await saveSpec(result.spec, outputFile);
    }

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

    if (args["dry-run"]) {
      console.log("\n⚠️  Dry run mode - no files were modified");
    } else {
      console.log(`\n✅ Success! Extracted spec saved to ${outputFile}`);
    }
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
