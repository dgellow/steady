#!/usr/bin/env -S deno run --allow-all
/**
 * Micro-benchmarks: Test specific performance aspects
 *
 * Tests internal operations without network overhead:
 * 1. Path matching algorithms
 * 2. JSON Schema validation
 * 3. Response generation
 */

import { parseSpecFromFile } from "../packages/openapi/parser.ts";
import { SchemaRegistry, RegistryValidator, RegistryResponseGenerator } from "../packages/json-schema/mod.ts";
import { compilePathPattern, matchCompiledPath } from "../src/path-matcher.ts";

const SPEC_PATH = "./test-spec.yaml";
const ITERATIONS = 1000;

interface MicroBenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

function runBench(name: string, fn: () => void, iterations: number): MicroBenchResult {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  // Measure
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;

  return {
    name,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

async function main() {
  console.log("🔬 Micro-benchmarks for Steady internals\n");

  // Load spec
  console.log("Loading Cloudflare spec...");
  const specStart = performance.now();
  const spec = await parseSpecFromFile(SPEC_PATH);
  const specLoadTime = performance.now() - specStart;
  console.log(`  Spec loaded in ${specLoadTime.toFixed(0)}ms\n`);

  // Extract paths
  const paths = Object.keys(spec.paths ?? {});
  console.log(`  Found ${paths.length} paths\n`);

  // Build registry
  console.log("Building SchemaRegistry...");
  const registryStart = performance.now();
  const registry = new SchemaRegistry(spec);
  const registryBuildTime = performance.now() - registryStart;
  console.log(`  Registry built in ${registryBuildTime.toFixed(0)}ms\n`);

  const results: MicroBenchResult[] = [];

  // ============================================================
  // Benchmark 1: Path Pattern Compilation
  // ============================================================
  console.log("1. Path Pattern Compilation");
  const compilePaths = paths.slice(0, 100); // Use first 100 paths
  results.push(runBench(
    "Path compilation (100 patterns)",
    () => {
      for (const path of compilePaths) {
        compilePathPattern(path);
      }
    },
    ITERATIONS
  ));

  // ============================================================
  // Benchmark 2: Path Matching (Pre-compiled)
  // ============================================================
  console.log("2. Path Matching (Pre-compiled)");
  const compiledPatterns = paths.slice(0, 100).map(p => compilePathPattern(p));
  const testPaths = [
    "/accounts/abc123",
    "/zones/zone-id-here/settings",
    "/user/tokens/token-id",
    "/accounts/acc-id/workers/scripts/my-script",
  ];

  results.push(runBench(
    "Path matching (100 patterns x 4 requests)",
    () => {
      for (const testPath of testPaths) {
        for (const compiled of compiledPatterns) {
          matchCompiledPath(testPath, compiled);
        }
      }
    },
    ITERATIONS
  ));

  // ============================================================
  // Benchmark 3: Schema Resolution via Registry
  // ============================================================
  console.log("3. Schema Resolution via Registry");
  const refs = [
    "#/components/schemas/iam_api-response-common-failure",
    "#/components/schemas/iam_response_collection_accounts",
  ];

  results.push(runBench(
    "Schema resolution (2 refs)",
    () => {
      for (const ref of refs) {
        registry.resolveRef(ref);
      }
    },
    ITERATIONS * 10
  ));

  // ============================================================
  // Benchmark 4: JSON Schema Validation
  // ============================================================
  console.log("4. JSON Schema Validation");
  const validator = new RegistryValidator(registry);

  // Sample data to validate
  const validData = {
    id: "12345",
    name: "test-account",
    email: "test@example.com",
    created_on: "2024-01-15T10:30:00Z",
    settings: {
      advanced_ddos: true,
      access_approval: false,
    },
  };

  // Simple schema for validation
  const testSchema = {
    type: "object" as const,
    properties: {
      id: { type: "string" as const },
      name: { type: "string" as const, minLength: 1 },
      email: { type: "string" as const, format: "email" },
      created_on: { type: "string" as const, format: "date-time" },
      settings: {
        type: "object" as const,
        properties: {
          advanced_ddos: { type: "boolean" as const },
          access_approval: { type: "boolean" as const },
        },
      },
    },
    required: ["id", "name"] as string[],
  };

  results.push(runBench(
    "JSON Schema validation (nested object)",
    () => {
      validator.validateData(testSchema, validData);
    },
    ITERATIONS * 10
  ));

  // ============================================================
  // Benchmark 5: Response Generation
  // ============================================================
  console.log("5. Response Generation");
  const generator = new RegistryResponseGenerator(registry);

  const responseSchema = {
    type: "object" as const,
    properties: {
      success: { type: "boolean" as const },
      errors: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            code: { type: "integer" as const },
            message: { type: "string" as const },
          },
        },
      },
      result: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, format: "uuid" },
          name: { type: "string" as const },
          status: {
            type: "string" as const,
            enum: ["active", "pending", "disabled"],
          },
        },
      },
    },
  };

  results.push(runBench(
    "Response generation (nested with enum)",
    () => {
      generator.generate(responseSchema);
    },
    ITERATIONS
  ));

  // ============================================================
  // Print Results
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("MICRO-BENCHMARK RESULTS");
  console.log("=".repeat(70));

  console.log(`\nSpec loading: ${specLoadTime.toFixed(0)}ms`);
  console.log(`Registry build: ${registryBuildTime.toFixed(0)}ms`);
  console.log(`Total initialization: ${(specLoadTime + registryBuildTime).toFixed(0)}ms\n`);

  const headers = ["Test", "Iterations", "Total (ms)", "Avg (ms)", "Ops/sec"];
  const widths = [45, 12, 12, 12, 12];

  console.log(headers.map((h, i) => h.padEnd(widths[i]!)).join("│"));
  console.log(widths.map(w => "─".repeat(w)).join("┼"));

  for (const r of results) {
    const row = [
      r.name,
      r.iterations.toString(),
      r.totalMs.toFixed(2),
      r.avgMs.toFixed(4),
      r.opsPerSec.toFixed(0),
    ];
    console.log(row.map((c, i) => c.padEnd(widths[i]!)).join("│"));
  }

  console.log("\n" + "=".repeat(70));
  console.log("KEY INSIGHTS");
  console.log("=".repeat(70));

  console.log(`
1. Path matching uses pre-compiled patterns (O(1) for exact, O(n) for patterns)
2. Schema resolution uses Map-based O(1) lookup via registry cache
3. Validation is recursive but uses efficient Set-based tracking
4. Response generation uses deterministic seeded RNG for reproducibility
`);
}

main().catch(console.error);
