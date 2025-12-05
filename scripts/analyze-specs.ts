#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Comprehensive OpenAPI Spec Analysis
 *
 * Processes all specs with full profiling, tracing, and categorization.
 * Produces a detailed report for the feedback loop.
 *
 * Usage:
 *   deno task analyze              # Full analysis
 *   deno task analyze --limit 100  # Limited analysis
 *   deno task analyze --verbose    # With trace logs
 */

import { parseSpec } from "../packages/parser/parser.ts";
import { OpenAPIDocument } from "../packages/json-schema/openapi-document.ts";
import type { Diagnostic } from "../packages/json-schema/diagnostics/types.ts";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

// ============================================================================
// Types
// ============================================================================

interface SpecResult {
  path: string;
  name: string;
  version: string | null;
  size: number;
  parseTimeMs: number;
  analyzeTimeMs: number;
  status: "success" | "parse-error" | "analyze-error";
  error?: string;
  errorCategory?: string;
  diagnostics: Diagnostic[];
}

interface AnalysisReport {
  timestamp: string;
  totalSpecs: number;
  successCount: number;
  parseErrorCount: number;
  analyzeErrorCount: number;
  totalDiagnostics: number;
  totalTimeMs: number;
  avgParseTimeMs: number;
  avgAnalyzeTimeMs: number;

  // Categorized errors
  errorsByCategory: Record<string, { count: number; examples: string[] }>;

  // Diagnostics summary
  diagnosticsByCode: Record<string, {
    count: number;
    severity: string;
    attribution: string;
    examples: Array<{ spec: string; pointer: string; message: string }>;
  }>;

  // Version distribution
  versionDistribution: Record<string, number>;

  // Performance outliers
  slowestSpecs: Array<
    { name: string; parseMs: number; analyzeMs: number; size: number }
  >;
  largestSpecs: Array<{ name: string; size: number; diagnosticCount: number }>;
}

// ============================================================================
// Error Categorization
// ============================================================================

function categorizeError(error: string): string {
  if (error.includes("Missing paths")) return "missing-paths";
  if (error.includes("Missing or invalid OpenAPI version")) {
    return "invalid-version";
  }
  if (error.includes("Missing or invalid info")) return "invalid-info";
  if (error.includes("Missing API title")) return "missing-title";
  if (error.includes("Missing API version")) return "missing-api-version";
  if (error.includes("Unsupported OpenAPI version")) {
    return "unsupported-version";
  }
  if (error.includes("Invalid YAML") || error.includes("YAMLError")) {
    return "yaml-parse-error";
  }
  if (error.includes("Invalid JSON") || error.includes("SyntaxError")) {
    return "json-parse-error";
  }
  if (error.includes("not an object")) return "invalid-structure";
  if (error.includes("$ref")) return "ref-error";
  if (error.includes("circular")) return "circular-ref";
  return "other";
}

// ============================================================================
// Spec Discovery
// ============================================================================

async function findSpecs(dir: string, limit = Infinity): Promise<string[]> {
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
          (entry.name === "openapi.yaml" || entry.name === "openapi.json") &&
          !fullPath.includes("swagger")
        ) {
          specs.push(fullPath);
        }
      }
    } catch {
      // ignore permission errors
    }
  }

  await walk(dir);
  return specs;
}

// ============================================================================
// Spec Processing
// ============================================================================

async function processSpec(
  path: string,
  verbose: boolean,
): Promise<SpecResult> {
  const shortName = path.replace(OPENAPI_DIR + "/", "");
  const content = await Deno.readTextFile(path);
  const size = new TextEncoder().encode(content).length;
  const format = path.endsWith(".yaml") || path.endsWith(".yml")
    ? "yaml"
    : "json";

  const result: SpecResult = {
    path,
    name: shortName,
    version: null,
    size,
    parseTimeMs: 0,
    analyzeTimeMs: 0,
    status: "success",
    diagnostics: [],
  };

  // Parse
  const parseStart = performance.now();
  let spec: unknown;
  try {
    spec = await parseSpec(content, { format });
    result.parseTimeMs = performance.now() - parseStart;

    // Extract version
    if (typeof spec === "object" && spec !== null && "openapi" in spec) {
      result.version = String((spec as Record<string, unknown>).openapi);
    }
  } catch (error) {
    result.parseTimeMs = performance.now() - parseStart;
    result.status = "parse-error";
    result.error = error instanceof Error ? error.message : String(error);
    result.errorCategory = categorizeError(result.error);
    if (verbose) {
      console.error(
        `  ❌ Parse error [${result.errorCategory}]: ${
          result.error.slice(0, 100)
        }`,
      );
    }
    return result;
  }

  // Analyze
  const analyzeStart = performance.now();
  try {
    const doc = new OpenAPIDocument(spec);
    result.diagnostics = doc.getDiagnostics();
    result.analyzeTimeMs = performance.now() - analyzeStart;
  } catch (error) {
    result.analyzeTimeMs = performance.now() - analyzeStart;
    result.status = "analyze-error";
    result.error = error instanceof Error ? error.message : String(error);
    result.errorCategory = categorizeError(result.error);
    if (verbose) {
      console.error(
        `  ❌ Analyze error [${result.errorCategory}]: ${
          result.error.slice(0, 100)
        }`,
      );
    }
    return result;
  }

  if (verbose && result.diagnostics.length > 0) {
    console.log(`  📋 ${result.diagnostics.length} diagnostics`);
  }

  return result;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(results: SpecResult[]): AnalysisReport {
  const successResults = results.filter((r) => r.status === "success");
  const parseErrors = results.filter((r) => r.status === "parse-error");
  const analyzeErrors = results.filter((r) => r.status === "analyze-error");

  // Error categorization
  const errorsByCategory: Record<
    string,
    { count: number; examples: string[] }
  > = {};
  for (const r of [...parseErrors, ...analyzeErrors]) {
    const cat = r.errorCategory ?? "unknown";
    if (!errorsByCategory[cat]) {
      errorsByCategory[cat] = { count: 0, examples: [] };
    }
    errorsByCategory[cat].count++;
    if (errorsByCategory[cat].examples.length < 3) {
      errorsByCategory[cat].examples.push(
        `${r.name}: ${r.error?.slice(0, 80)}`,
      );
    }
  }

  // Diagnostics summary
  const diagnosticsByCode: Record<string, {
    count: number;
    severity: string;
    attribution: string;
    examples: Array<{ spec: string; pointer: string; message: string }>;
  }> = {};

  for (const r of successResults) {
    for (const d of r.diagnostics) {
      if (!diagnosticsByCode[d.code]) {
        diagnosticsByCode[d.code] = {
          count: 0,
          severity: d.severity,
          attribution: d.attribution.type,
          examples: [],
        };
      }
      diagnosticsByCode[d.code].count++;
      if (diagnosticsByCode[d.code].examples.length < 5) {
        diagnosticsByCode[d.code].examples.push({
          spec: r.name,
          pointer: d.pointer,
          message: d.message.slice(0, 100),
        });
      }
    }
  }

  // Version distribution
  const versionDistribution: Record<string, number> = {};
  for (const r of successResults) {
    const v = r.version ?? "unknown";
    versionDistribution[v] = (versionDistribution[v] ?? 0) + 1;
  }

  // Performance outliers
  const sortedByTime = [...successResults].sort(
    (a, b) =>
      (b.parseTimeMs + b.analyzeTimeMs) - (a.parseTimeMs + a.analyzeTimeMs),
  );
  const slowestSpecs = sortedByTime.slice(0, 10).map((r) => ({
    name: r.name,
    parseMs: Math.round(r.parseTimeMs),
    analyzeMs: Math.round(r.analyzeTimeMs),
    size: r.size,
  }));

  const sortedBySize = [...successResults].sort((a, b) => b.size - a.size);
  const largestSpecs = sortedBySize.slice(0, 10).map((r) => ({
    name: r.name,
    size: r.size,
    diagnosticCount: r.diagnostics.length,
  }));

  // Totals
  const totalDiagnostics = successResults.reduce(
    (sum, r) => sum + r.diagnostics.length,
    0,
  );
  const totalParseTime = results.reduce((sum, r) => sum + r.parseTimeMs, 0);
  const totalAnalyzeTime = successResults.reduce(
    (sum, r) => sum + r.analyzeTimeMs,
    0,
  );

  return {
    timestamp: new Date().toISOString(),
    totalSpecs: results.length,
    successCount: successResults.length,
    parseErrorCount: parseErrors.length,
    analyzeErrorCount: analyzeErrors.length,
    totalDiagnostics,
    totalTimeMs: totalParseTime + totalAnalyzeTime,
    avgParseTimeMs: totalParseTime / results.length,
    avgAnalyzeTimeMs: totalAnalyzeTime / successResults.length,
    errorsByCategory,
    diagnosticsByCode,
    versionDistribution,
    slowestSpecs,
    largestSpecs,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printReport(report: AnalysisReport): void {
  const line = "═".repeat(80);

  console.log("\n" + line);
  console.log("  OPENAPI SPEC ANALYSIS REPORT");
  console.log("  " + report.timestamp);
  console.log(line + "\n");

  // Overview
  console.log("📊 OVERVIEW");
  console.log("─".repeat(40));
  console.log(`  Total specs:     ${report.totalSpecs}`);
  console.log(
    `  Successful:      ${report.successCount} (${
      (report.successCount / report.totalSpecs * 100).toFixed(1)
    }%)`,
  );
  console.log(`  Parse errors:    ${report.parseErrorCount}`);
  console.log(`  Analyze errors:  ${report.analyzeErrorCount}`);
  console.log(`  Total diagnostics: ${report.totalDiagnostics}`);
  console.log(`  Total time:      ${(report.totalTimeMs / 1000).toFixed(2)}s`);
  console.log(`  Avg parse time:  ${report.avgParseTimeMs.toFixed(1)}ms`);
  console.log(`  Avg analyze time: ${report.avgAnalyzeTimeMs.toFixed(1)}ms`);
  console.log("");

  // Version distribution
  console.log("📋 VERSION DISTRIBUTION");
  console.log("─".repeat(40));
  const versions = Object.entries(report.versionDistribution)
    .sort((a, b) => b[1] - a[1]);
  for (const [version, count] of versions) {
    const pct = (count / report.successCount * 100).toFixed(1);
    console.log(
      `  ${version.padEnd(12)} ${count.toString().padStart(5)} (${pct}%)`,
    );
  }
  console.log("");

  // Error categories
  if (Object.keys(report.errorsByCategory).length > 0) {
    console.log("❌ ERROR CATEGORIES");
    console.log("─".repeat(40));
    const errors = Object.entries(report.errorsByCategory)
      .sort((a, b) => b[1].count - a[1].count);
    for (const [category, data] of errors) {
      console.log(`  ${category}: ${data.count}`);
      for (const example of data.examples.slice(0, 2)) {
        console.log(`    → ${example.slice(0, 70)}...`);
      }
    }
    console.log("");
  }

  // Diagnostics
  console.log("🔍 DIAGNOSTICS BY CODE");
  console.log("─".repeat(40));
  const diagnostics = Object.entries(report.diagnosticsByCode)
    .sort((a, b) => b[1].count - a[1].count);
  for (const [code, data] of diagnostics) {
    const icon = data.severity === "error"
      ? "❌"
      : data.severity === "warning"
      ? "⚠️"
      : data.severity === "info"
      ? "ℹ️"
      : "💡";
    console.log(`  ${icon} ${code}: ${data.count} (${data.attribution})`);
    // Show a sample
    if (data.examples.length > 0) {
      const ex = data.examples[0];
      console.log(`     Sample: ${ex.spec}`);
      console.log(`     At: ${ex.pointer}`);
    }
    console.log("");
  }

  // Performance
  console.log("⏱️  SLOWEST SPECS");
  console.log("─".repeat(40));
  for (const spec of report.slowestSpecs.slice(0, 5)) {
    console.log(`  ${spec.name}`);
    console.log(
      `     Parse: ${spec.parseMs}ms, Analyze: ${spec.analyzeMs}ms, Size: ${
        formatBytes(spec.size)
      }`,
    );
  }
  console.log("");

  console.log("📦 LARGEST SPECS");
  console.log("─".repeat(40));
  for (const spec of report.largestSpecs.slice(0, 5)) {
    console.log(`  ${spec.name}`);
    console.log(
      `     Size: ${
        formatBytes(spec.size)
      }, Diagnostics: ${spec.diagnosticCount}`,
    );
  }
  console.log("");

  console.log(line + "\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = Deno.args;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;
  const verbose = args.includes("--verbose") || args.includes("-v");
  const jsonOutput = args.includes("--json");

  console.log("🔍 Finding OpenAPI specs...\n");
  const specPaths = await findSpecs(OPENAPI_DIR, limit);
  console.log(`Found ${specPaths.length} specs to analyze\n`);

  if (limit !== Infinity) {
    console.log(`⚠️  Limited to ${limit} specs\n`);
  }

  const results: SpecResult[] = [];
  const startTime = performance.now();

  for (let i = 0; i < specPaths.length; i++) {
    const path = specPaths[i];
    const shortName = path.replace(OPENAPI_DIR + "/", "");

    if (verbose) {
      console.log(`[${i + 1}/${specPaths.length}] ${shortName}`);
    } else if ((i + 1) % 100 === 0) {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${i + 1}/${specPaths.length} (${elapsed}s)`);
    }

    const result = await processSpec(path, verbose);
    results.push(result);
  }

  const report = generateReport(results);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  // Save report to file
  const reportPath =
    new URL("../analysis-report.json", import.meta.url).pathname;
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Full report saved to: analysis-report.json\n`);
}

main();
