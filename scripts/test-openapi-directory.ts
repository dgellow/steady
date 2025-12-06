#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Test Steady's parser against the APIs-guru openapi-directory
 *
 * Usage:
 *   deno task test:specs              # Run against all specs
 *   deno task test:specs --limit 100  # Test first 100 specs
 *   deno task test:specs --filter stripe  # Test only specs matching "stripe"
 */

import { parseSpec } from "../packages/openapi/parser.ts";

// Path to the openapi-directory submodule
const OPENAPI_DIR =
  new URL("../test-fixtures/openapi-directory/APIs", import.meta.url).pathname;

interface TestResult {
  path: string;
  success: boolean;
  error?: string;
  parseTimeMs: number;
  sizeBytes: number;
}

async function findSpecs(dir: string, openapi3Only = true): Promise<string[]> {
  const specs: string[] = [];

  async function walk(path: string) {
    for await (const entry of Deno.readDir(path)) {
      const fullPath = `${path}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".json")) {
        // Filter out Swagger 2.0 specs (they have "swagger" in filename)
        if (openapi3Only && entry.name.includes("swagger")) {
          continue;
        }
        specs.push(fullPath);
      }
    }
  }

  await walk(dir);
  return specs;
}

async function testSpec(path: string): Promise<TestResult> {
  const start = performance.now();
  let content: string;

  try {
    content = await Deno.readTextFile(path);
  } catch (e) {
    return {
      path,
      success: false,
      error: `Failed to read file: ${
        e instanceof Error ? e.message : String(e)
      }`,
      parseTimeMs: performance.now() - start,
      sizeBytes: 0,
    };
  }

  const sizeBytes = new TextEncoder().encode(content).length;

  try {
    const format = path.endsWith(".yaml") || path.endsWith(".yml")
      ? "yaml"
      : "json";
    await parseSpec(content, { format });
    return {
      path,
      success: true,
      parseTimeMs: performance.now() - start,
      sizeBytes,
    };
  } catch (e) {
    return {
      path,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      parseTimeMs: performance.now() - start,
      sizeBytes,
    };
  }
}

async function main() {
  const args = Deno.args;
  const limitIdx = args.indexOf("--limit");
  const limitArg = limitIdx !== -1 ? args[limitIdx + 1] : undefined;
  const limit = limitArg ? parseInt(limitArg) : Infinity;
  const filterIdx = args.indexOf("--filter");
  const filterArg = filterIdx !== -1 ? args[filterIdx + 1] : undefined;
  const filter = filterArg ? filterArg.toLowerCase() : null;
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log("🔍 Finding OpenAPI specs...");
  let specs = await findSpecs(OPENAPI_DIR);

  if (filter) {
    specs = specs.filter((s) => s.toLowerCase().includes(filter));
    console.log(`📋 Filtered to ${specs.length} specs matching "${filter}"`);
  }

  if (limit < specs.length) {
    specs = specs.slice(0, limit);
    console.log(`📋 Limited to ${limit} specs`);
  }

  console.log(`\n🧪 Testing ${specs.length} specs...\n`);

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec) continue;
    const shortPath = spec.replace(OPENAPI_DIR + "/", "");

    const result = await testSpec(spec);
    results.push(result);

    if (result.success) {
      passed++;
      if (verbose) {
        console.log(
          `✅ ${shortPath} (${result.parseTimeMs.toFixed(0)}ms, ${
            (result.sizeBytes / 1024).toFixed(1)
          }KB)`,
        );
      }
    } else {
      failed++;
      console.log(`❌ ${shortPath}`);
      console.log(`   Error: ${result.error?.split("\n")[0]}`);
    }

    // Progress indicator every 100 specs
    if (!verbose && (i + 1) % 100 === 0) {
      console.log(
        `   Progress: ${
          i + 1
        }/${specs.length} (${passed} passed, ${failed} failed)`,
      );
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total:  ${specs.length}`);
  console.log(
    `Passed: ${passed} (${(passed / specs.length * 100).toFixed(1)}%)`,
  );
  console.log(
    `Failed: ${failed} (${(failed / specs.length * 100).toFixed(1)}%)`,
  );

  // Timing stats
  const times = results.map((r) => r.parseTimeMs);
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const maxTime = Math.max(...times);
  const slowest = results.find((r) => r.parseTimeMs === maxTime);

  console.log(
    `\nParse time: avg ${avgTime.toFixed(0)}ms, max ${maxTime.toFixed(0)}ms`,
  );
  if (slowest) {
    console.log(`Slowest: ${slowest.path.replace(OPENAPI_DIR + "/", "")}`);
  }

  // Size stats
  const sizes = results.map((r) => r.sizeBytes);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  const maxSize = Math.max(...sizes);
  const largest = results.find((r) => r.sizeBytes === maxSize);

  console.log(`\nTotal size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
  if (largest) {
    console.log(
      `Largest: ${largest.path.replace(OPENAPI_DIR + "/", "")} (${
        (largest.sizeBytes / 1024 / 1024).toFixed(1)
      }MB)`,
    );
  }

  // Top 10 failures by error type
  if (failed > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("TOP FAILURE REASONS");
    console.log("=".repeat(60));

    const errorCounts = new Map<string, number>();
    for (const r of results.filter((r) => !r.success)) {
      const firstLine = r.error?.split("\n")[0];
      const errorType = firstLine?.slice(0, 80) ?? "Unknown";
      errorCounts.set(errorType, (errorCounts.get(errorType) ?? 0) + 1);
    }

    const sorted = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(
      0,
      10,
    );
    for (const [error, count] of sorted) {
      console.log(`${count.toString().padStart(4)} × ${error}`);
    }
  }

  // Exit with error code if any failed
  Deno.exit(failed > 0 ? 1 : 0);
}

main();
