#!/usr/bin/env -S deno run --allow-read

/**
 * Collect diagnostics from real OpenAPI specs
 *
 * Usage:
 *   deno run --allow-read scripts/collect-diagnostics.ts
 *   deno run --allow-read scripts/collect-diagnostics.ts --limit 10
 *   deno run --allow-read scripts/collect-diagnostics.ts --filter stripe
 */

import { parseSpec } from "../packages/parser/parser.ts";
import { OpenAPIDocument } from "../packages/json-schema/openapi-document.ts";
import type { Diagnostic } from "../packages/json-schema/diagnostics/types.ts";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

interface SpecDiagnostics {
  specPath: string;
  specName: string;
  diagnostics: Diagnostic[];
}

async function findSpecs(dir: string, limit = Infinity, filter?: string): Promise<string[]> {
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
          if (!filter || fullPath.toLowerCase().includes(filter.toLowerCase())) {
            specs.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  await walk(dir);
  return specs;
}

async function analyzeSpec(path: string): Promise<SpecDiagnostics | null> {
  const shortPath = path.replace(OPENAPI_DIR + "/", "");

  try {
    const content = await Deno.readTextFile(path);
    const format = path.endsWith(".yaml") || path.endsWith(".yml") ? "yaml" : "json";
    const spec = await parseSpec(content, { format });

    const doc = new OpenAPIDocument(spec);
    const diagnostics = doc.getDiagnostics();

    return {
      specPath: path,
      specName: shortPath,
      diagnostics,
    };
  } catch (error) {
    // Parse errors are expected for some specs
    console.error(`Failed to parse ${shortPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function formatDiagnostic(d: Diagnostic, specName: string): string {
  const lines: string[] = [];
  const severityIcon = {
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
    hint: "💡",
  }[d.severity];

  lines.push(`${severityIcon} [${d.severity.toUpperCase()}] ${d.code}`);
  lines.push(`   Spec: ${specName}`);
  lines.push(`   Location: ${d.pointer}`);
  lines.push(`   Message: ${d.message}`);
  lines.push(`   Attribution: ${d.attribution.type} (${Math.round(d.attribution.confidence * 100)}% confidence)`);
  lines.push(`   Reasoning: ${d.attribution.reasoning}`);
  if (d.suggestion) {
    lines.push(`   Suggestion: ${d.suggestion}`);
  }

  return lines.join("\n");
}

async function main() {
  const args = Deno.args;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50;
  const filterIdx = args.indexOf("--filter");
  const filter = filterIdx !== -1 ? args[filterIdx + 1] : undefined;

  console.log("🔍 Finding OpenAPI specs...\n");
  const specPaths = await findSpecs(OPENAPI_DIR, limit, filter);
  console.log(`Found ${specPaths.length} specs to analyze\n`);

  const allDiagnostics: SpecDiagnostics[] = [];

  for (const specPath of specPaths) {
    const result = await analyzeSpec(specPath);
    if (result && result.diagnostics.length > 0) {
      allDiagnostics.push(result);
    }
  }

  // Group diagnostics by code
  const byCode = new Map<string, { diagnostic: Diagnostic; specName: string }[]>();

  for (const spec of allDiagnostics) {
    for (const d of spec.diagnostics) {
      const list = byCode.get(d.code) ?? [];
      list.push({ diagnostic: d, specName: spec.specName });
      byCode.set(d.code, list);
    }
  }

  // Print summary
  console.log("=" .repeat(80));
  console.log("DIAGNOSTIC SUMMARY");
  console.log("=".repeat(80));
  console.log("");

  let totalDiagnostics = 0;
  const sortedCodes = Array.from(byCode.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [code, items] of sortedCodes) {
    totalDiagnostics += items.length;
    const first = items[0]!;
    console.log(`${code}: ${items.length} occurrences`);
    console.log(`  Severity: ${first.diagnostic.severity}`);
    console.log(`  Attribution: ${first.diagnostic.attribution.type}`);
    console.log("");
  }

  console.log(`Total: ${totalDiagnostics} diagnostics across ${allDiagnostics.length} specs\n`);

  // Print detailed diagnostics (first few of each type)
  console.log("=".repeat(80));
  console.log("DETAILED DIAGNOSTICS (first 3 of each type)");
  console.log("=".repeat(80));
  console.log("");

  for (const [code, items] of sortedCodes) {
    console.log(`\n--- ${code} (${items.length} total) ---\n`);

    const samples = items.slice(0, 3);
    for (const { diagnostic, specName } of samples) {
      console.log(formatDiagnostic(diagnostic, specName));
      console.log("");
    }
  }
}

main();
