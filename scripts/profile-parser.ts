#!/usr/bin/env -S deno run --allow-read --allow-write --v8-flags=--prof

/**
 * Profile Steady's parser against OpenAPI specs
 *
 * Usage:
 *   deno run --allow-read --v8-flags=--prof scripts/profile-parser.ts
 *   # Then process with: deno --v8-flags=--prof-process isolate-*.log > profile.txt
 *
 * Or for built-in timing:
 *   deno task profile
 */

import { parseSpec } from "../packages/parser/parser.ts";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

interface TimingResult {
  spec: string;
  sizeKB: number;
  totalMs: number;
  readMs: number;
  parseYamlMs: number;
  validateMs: number;
}

interface PhaseTimings {
  read: number;
  parseYaml: number;
  validate: number;
}

async function findSpecs(dir: string, limit = 50): Promise<string[]> {
  const specs: string[] = [];

  async function walk(path: string) {
    if (specs.length >= limit) return;
    try {
      for await (const entry of Deno.readDir(path)) {
        if (specs.length >= limit) return;
        const fullPath = `${path}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(fullPath);
        } else if (
          (entry.name.endsWith(".yaml") || entry.name.endsWith(".json")) &&
          !entry.name.includes("swagger")
        ) {
          specs.push(fullPath);
        }
      }
    } catch {
      // ignore
    }
  }

  await walk(dir);
  return specs;
}

async function profileSpec(path: string): Promise<TimingResult> {
  const shortPath = path.replace(OPENAPI_DIR + "/", "");

  // Phase 1: Read file
  const readStart = performance.now();
  const content = await Deno.readTextFile(path);
  const readMs = performance.now() - readStart;

  const sizeKB = new TextEncoder().encode(content).length / 1024;

  // Phase 2: Parse YAML (we'll measure this separately)
  const parseStart = performance.now();
  const format = path.endsWith(".yaml") || path.endsWith(".yml") ? "yaml" : "json";

  // We can't easily separate YAML parsing from validation without modifying the parser
  // So we'll measure total parse time
  const totalParseStart = performance.now();
  try {
    await parseSpec(content, { format });
  } catch {
    // Ignore parse errors for profiling
  }
  const totalParseMs = performance.now() - totalParseStart;

  // Estimate YAML vs validation split (rough approximation)
  // YAML parsing is typically 60-80% of total time for large specs
  const parseYamlMs = totalParseMs * 0.7;
  const validateMs = totalParseMs * 0.3;

  return {
    spec: shortPath,
    sizeKB,
    totalMs: readMs + totalParseMs,
    readMs,
    parseYamlMs,
    validateMs,
  };
}

async function main() {
  console.log("🔬 Profiling Steady Parser\n");
  console.log("Finding specs...");

  const specs = await findSpecs(OPENAPI_DIR, 100);
  console.log(`Found ${specs.length} specs to profile\n`);

  // Sort by size to get a mix
  const specSizes: { path: string; size: number }[] = [];
  for (const spec of specs) {
    try {
      const stat = await Deno.stat(spec);
      specSizes.push({ path: spec, size: stat.size });
    } catch {
      continue;
    }
  }
  specSizes.sort((a, b) => b.size - a.size);

  // Profile top 30 largest specs
  const toProfile = specSizes.slice(0, 30);

  console.log("=".repeat(80));
  console.log("PROFILING RESULTS");
  console.log("=".repeat(80));
  console.log("");

  const results: TimingResult[] = [];

  for (const { path } of toProfile) {
    const result = await profileSpec(path);
    results.push(result);

    const bar = "█".repeat(Math.min(50, Math.round(result.totalMs / 20)));
    console.log(
      `${result.spec.slice(0, 50).padEnd(50)} ${result.sizeKB.toFixed(0).padStart(6)}KB ${result.totalMs.toFixed(0).padStart(5)}ms ${bar}`,
    );
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("SUMMARY STATISTICS");
  console.log("=".repeat(80));
  console.log("");

  // Calculate statistics
  const totalSize = results.reduce((a, b) => a + b.sizeKB, 0);
  const totalTime = results.reduce((a, b) => a + b.totalMs, 0);
  const avgTime = totalTime / results.length;
  const avgSize = totalSize / results.length;

  // Throughput
  const throughputKBperSec = (totalSize / totalTime) * 1000;
  const throughputMBperSec = throughputKBperSec / 1024;

  console.log(`Specs profiled:    ${results.length}`);
  console.log(`Total size:        ${(totalSize / 1024).toFixed(1)} MB`);
  console.log(`Total parse time:  ${(totalTime / 1000).toFixed(2)} seconds`);
  console.log(`Average time:      ${avgTime.toFixed(0)} ms`);
  console.log(`Average size:      ${avgSize.toFixed(0)} KB`);
  console.log(`Throughput:        ${throughputMBperSec.toFixed(1)} MB/s`);

  console.log("");
  console.log("=".repeat(80));
  console.log("BOTTLENECK ANALYSIS");
  console.log("=".repeat(80));
  console.log("");

  // Find slowest specs relative to size
  const normalized = results.map((r) => ({
    ...r,
    msPerKB: r.totalMs / r.sizeKB,
  }));
  normalized.sort((a, b) => b.msPerKB - a.msPerKB);

  console.log("Slowest specs (ms per KB):");
  for (const r of normalized.slice(0, 10)) {
    console.log(
      `  ${r.spec.slice(0, 50).padEnd(50)} ${r.msPerKB.toFixed(2)} ms/KB (${r.sizeKB.toFixed(0)}KB in ${r.totalMs.toFixed(0)}ms)`,
    );
  }

  console.log("");
  console.log("Fastest specs (ms per KB):");
  for (const r of normalized.slice(-5).reverse()) {
    console.log(
      `  ${r.spec.slice(0, 50).padEnd(50)} ${r.msPerKB.toFixed(2)} ms/KB (${r.sizeKB.toFixed(0)}KB in ${r.totalMs.toFixed(0)}ms)`,
    );
  }

  // Size vs time correlation
  console.log("");
  console.log("=".repeat(80));
  console.log("SIZE VS TIME CORRELATION");
  console.log("=".repeat(80));
  console.log("");

  // Group by size buckets
  const buckets = [
    { name: "Small (<100KB)", min: 0, max: 100, results: [] as TimingResult[] },
    { name: "Medium (100KB-1MB)", min: 100, max: 1024, results: [] as TimingResult[] },
    { name: "Large (1MB-5MB)", min: 1024, max: 5120, results: [] as TimingResult[] },
    { name: "XLarge (>5MB)", min: 5120, max: Infinity, results: [] as TimingResult[] },
  ];

  for (const r of results) {
    for (const bucket of buckets) {
      if (r.sizeKB >= bucket.min && r.sizeKB < bucket.max) {
        bucket.results.push(r);
        break;
      }
    }
  }

  for (const bucket of buckets) {
    if (bucket.results.length === 0) continue;
    const avgMs = bucket.results.reduce((a, b) => a + b.totalMs, 0) / bucket.results.length;
    const avgKB = bucket.results.reduce((a, b) => a + b.sizeKB, 0) / bucket.results.length;
    console.log(
      `${bucket.name.padEnd(20)} ${bucket.results.length.toString().padStart(3)} specs, avg ${avgMs.toFixed(0).padStart(5)}ms, avg ${avgKB.toFixed(0).padStart(6)}KB`,
    );
  }

  // Memory estimation
  console.log("");
  console.log("=".repeat(80));
  console.log("MEMORY ANALYSIS");
  console.log("=".repeat(80));
  console.log("");

  // Get heap stats if available
  // @ts-ignore - Deno runtime API
  if (Deno.memoryUsage) {
    const mem = Deno.memoryUsage();
    console.log(`Heap used:     ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Heap total:    ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`);
    console.log(`RSS:           ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
    console.log(`External:      ${(mem.external / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("RECOMMENDATIONS");
  console.log("=".repeat(80));
  console.log("");

  if (throughputMBperSec < 5) {
    console.log("⚠️  Throughput is below 5 MB/s - consider optimizing YAML parsing");
  } else if (throughputMBperSec < 10) {
    console.log("✓ Throughput is acceptable (5-10 MB/s)");
  } else {
    console.log("✅ Excellent throughput (>10 MB/s)");
  }

  const slowSpecs = normalized.filter((r) => r.msPerKB > 0.5);
  if (slowSpecs.length > 0) {
    console.log(`⚠️  ${slowSpecs.length} specs are slower than expected (>0.5ms/KB)`);
    console.log("   These may have complex schemas or deep nesting");
  }

  console.log("");
}

main();
