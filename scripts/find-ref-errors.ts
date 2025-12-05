#!/usr/bin/env -S deno run --allow-read

/**
 * Find all specs with ref-unresolved errors
 */

import { parseSpec } from "../packages/parser/parser.ts";
import { OpenAPIDocument } from "../packages/json-schema/openapi-document.ts";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

async function findSpecs(dir: string): Promise<string[]> {
  const specs: string[] = [];

  async function walk(path: string) {
    try {
      for await (const entry of Deno.readDir(path)) {
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
      // ignore
    }
  }

  await walk(dir);
  return specs;
}

async function main() {
  console.log("Finding specs with ref-unresolved errors...\n");

  const specPaths = await findSpecs(OPENAPI_DIR);
  const specsWithErrors: Array<{ spec: string; errors: string[] }> = [];

  for (const path of specPaths) {
    const shortName = path.replace(OPENAPI_DIR + "/", "");

    try {
      const content = await Deno.readTextFile(path);
      const format = path.endsWith(".yaml") ? "yaml" : "json";
      const spec = await parseSpec(content, { format });
      const doc = new OpenAPIDocument(spec);
      const diagnostics = doc.getDiagnostics();

      const refErrors = diagnostics.filter((d) => d.code === "ref-unresolved");
      if (refErrors.length > 0) {
        specsWithErrors.push({
          spec: shortName,
          errors: refErrors.map((e) => `${e.pointer}: ${e.message}`),
        });
      }
    } catch {
      // Skip parse errors
    }
  }

  console.log(
    `Found ${specsWithErrors.length} specs with ref-unresolved errors:\n`,
  );

  for (const { spec, errors } of specsWithErrors) {
    console.log(`📄 ${spec} (${errors.length} errors)`);
    for (const error of errors.slice(0, 3)) {
      console.log(`   ${error.slice(0, 100)}`);
    }
    if (errors.length > 3) {
      console.log(`   ... and ${errors.length - 3} more`);
    }
    console.log("");
  }

  // Summary by pattern
  const allErrors = specsWithErrors.flatMap((s) => s.errors);
  const patterns = new Map<string, number>();

  for (const error of allErrors) {
    if (error.includes("%7B")) {
      patterns.set(
        "percent-encoded-braces",
        (patterns.get("percent-encoded-braces") ?? 0) + 1,
      );
    } else if (error.includes("components")) {
      patterns.set(
        "missing-component",
        (patterns.get("missing-component") ?? 0) + 1,
      );
    } else {
      patterns.set("other", (patterns.get("other") ?? 0) + 1);
    }
  }

  console.log("Error patterns:");
  for (const [pattern, count] of patterns) {
    console.log(`  ${pattern}: ${count}`);
  }
}

main();
