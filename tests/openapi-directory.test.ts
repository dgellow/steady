/**
 * OpenAPI Directory Integration Tests
 *
 * Runs the full Steady validation pipeline (parse + analyze) on every
 * OpenAPI 3.x spec in APIs-guru/openapi-directory (~1970 specs).
 * Each spec is a separate test step.
 */

import { assert } from "@std/assert";
import { parseSpecFromFile } from "../packages/openapi/parser.ts";
import { analyzeSpec } from "../src/engine/spec-analyzer.ts";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

/** Specs with genuine errors (broken $refs, typos). Not Steady bugs. */
const SKIP = new Set([
  // $refs use "18_24" but schemas are named "1824" (no underscores). Typo.
  "statsocial.com/1.0.0/openapi.yaml",
]);

/** Recursively find all OpenAPI 3.x spec files. */
async function findSpecs(dir: string): Promise<string[]> {
  const specs: string[] = [];

  async function walk(path: string): Promise<void> {
    for await (const entry of Deno.readDir(path)) {
      const fullPath = `${path}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(fullPath);
      } else if (
        entry.name === "openapi.yaml" || entry.name === "openapi.json"
      ) {
        specs.push(fullPath);
      }
    }
  }

  await walk(dir);
  return specs.sort();
}

Deno.test("OpenAPI Directory", async (t) => {
  // Fail fast if submodule is missing
  let hasEntries = false;
  try {
    for await (const _entry of Deno.readDir(OPENAPI_DIR)) {
      hasEntries = true;
      break;
    }
  } catch {
    // directory doesn't exist
  }
  assert(
    hasEntries,
    "Submodule not initialized. Run: git submodule update --init",
  );

  const specs = await findSpecs(OPENAPI_DIR);
  assert(specs.length > 1000, `Expected 1000+ specs, found ${specs.length}`);

  for (const specPath of specs) {
    const name = specPath.replace(OPENAPI_DIR + "/", "");

    await t.step({
      name,
      ignore: SKIP.has(name),
      fn: async () => {
        const { spec, defaultedFields, shapeProblems } =
          await parseSpecFromFile(specPath);
        const result = analyzeSpec(spec, { defaultedFields, shapeProblems });
        assert(!result.fatal, result.diagnostics.map((d) => d.code).join(", "));
      },
    });
  }
});
