/**
 * Runs the official JSON Schema Test Suite (the `test-suite` submodule)
 * against the validator the server uses.
 *
 * As a module: `runSuite()` returns the outcome of every case. The
 * compliance test (`test-suite.test.ts`) compares that with the recorded
 * snapshot.
 *
 * As a script: prints the totals and every failing case.
 *
 *   deno task test:suite                 # draft 2020-12, required tests
 *   deno task test:suite path/to/file    # one file or one directory
 */

import * as path from "@std/path";
import { SchemaRegistry } from "./schema-registry.ts";
import { TreeValidator } from "./tree-validator.ts";
import type { Schema } from "./types.ts";

/** Required draft 2020-12 tests of the pinned suite. */
export const DRAFT_2020_12_DIR = path.join(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "test-suite",
  "tests",
  "draft2020-12",
);

interface TestCase {
  description: string;
  data: unknown;
  valid: boolean;
}

interface TestGroup {
  description: string;
  schema: Schema | boolean;
  tests: TestCase[];
}

export interface FailedCase {
  /** Suite file name, e.g. "required.json" */
  file: string;
  group: string;
  test: string;
  expected: boolean;
  actual: boolean;
  /** Validator message, or the exception text if the validator threw */
  detail?: string;
}

export interface SuiteResults {
  total: number;
  passed: number;
  failures: FailedCase[];
}

/**
 * Validate the way the server does: a registry over the document that
 * contains the schema, so `$ref`, `$anchor` and `$id` resolve through it.
 */
function validatorFor(schema: Schema | boolean): TreeValidator {
  if (typeof schema === "boolean") return new TreeValidator();
  return new TreeValidator({ registry: SchemaRegistry.fromSpec(schema) });
}

async function runFile(filePath: string): Promise<SuiteResults> {
  const groups: TestGroup[] = JSON.parse(await Deno.readTextFile(filePath));
  const file = path.basename(filePath);
  const results: SuiteResults = { total: 0, passed: 0, failures: [] };

  for (const group of groups) {
    for (const test of group.tests) {
      results.total++;

      let actual: boolean;
      let detail: string | undefined;
      try {
        const node = validatorFor(group.schema).validate(
          test.data,
          group.schema,
          "#",
          ["root"],
        );
        actual = node.valid;
        detail = node.message;
      } catch (error) {
        // A validator that throws has not accepted the instance.
        actual = false;
        detail = `threw: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }

      if (actual === test.valid) {
        results.passed++;
      } else {
        results.failures.push({
          file,
          group: group.description,
          test: test.description,
          expected: test.valid,
          actual,
          detail,
        });
      }
    }
  }

  return results;
}

/**
 * Run one suite file, or every `.json` file directly inside a directory.
 * Files are run in name order so the result is stable.
 */
export async function runSuite(target: string): Promise<SuiteResults> {
  const stat = await Deno.stat(target);
  if (stat.isFile) return await runFile(target);

  const files: string[] = [];
  for await (const entry of Deno.readDir(target)) {
    if (entry.isFile && entry.name.endsWith(".json")) files.push(entry.name);
  }
  files.sort();

  const totals: SuiteResults = { total: 0, passed: 0, failures: [] };
  for (const name of files) {
    const results = await runFile(path.join(target, name));
    totals.total += results.total;
    totals.passed += results.passed;
    totals.failures.push(...results.failures);
  }
  return totals;
}

if (import.meta.main) {
  const target = Deno.args[0] ?? DRAFT_2020_12_DIR;
  console.log(`Running JSON Schema test suite: ${target}`);
  const results = await runSuite(target);
  const failed = results.failures.length;

  console.log("\n=== Test Results ===");
  console.log(`Total: ${results.total}`);
  console.log(
    `Passed: ${results.passed} (${
      (results.passed / results.total * 100).toFixed(2)
    }%)`,
  );
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    const byGroup = new Map<string, number>();
    for (const f of results.failures) {
      const key = `${f.file}: ${f.group}`;
      byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
    }
    const sorted = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n=== Failed Groups (${sorted.length} groups) ===`);
    for (const [group, count] of sorted) {
      console.log(`  ${count}x  ${group}`);
    }

    console.log("\n=== All Failed Tests ===");
    for (const f of results.failures) {
      console.log(`\n${f.file}: ${f.group} - ${f.test}`);
      console.log(`Expected: ${f.expected}, Actual: ${f.actual}`);
      if (f.detail) console.log(`Detail: ${f.detail}`);
    }
  }
}
