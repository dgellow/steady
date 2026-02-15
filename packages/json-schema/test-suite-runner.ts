/**
 * Runner for the official JSON Schema test suite using TreeValidator
 */

import { TreeValidator } from "./tree-validator.ts";
import type { Schema } from "./types.ts";

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

interface TestResults {
  total: number;
  passed: number;
  failed: number;
  failedTests: Array<{
    group: string;
    test: string;
    expected: boolean;
    actual: boolean;
    schema: Schema | boolean;
    data: unknown;
    error?: string;
  }>;
}

export class TestSuiteRunner {
  private validator = new TreeValidator();

  async runTestFile(filePath: string): Promise<TestResults> {
    const content = await Deno.readTextFile(filePath);
    const testGroups: TestGroup[] = JSON.parse(content);

    const results: TestResults = {
      total: 0,
      passed: 0,
      failed: 0,
      failedTests: [],
    };

    for (const group of testGroups) {
      for (const test of group.tests) {
        results.total++;

        try {
          const node = this.validator.validate(
            test.data,
            group.schema,
            "#",
            ["root"],
          );
          const actual = node.valid;

          if (actual === test.valid) {
            results.passed++;
          } else {
            results.failed++;
            results.failedTests.push({
              group: group.description,
              test: test.description,
              expected: test.valid,
              actual,
              schema: group.schema,
              data: test.data,
              error: node.message,
            });
          }
        } catch (error) {
          results.failed++;
          results.failedTests.push({
            group: group.description,
            test: test.description,
            expected: test.valid,
            actual: false,
            schema: group.schema,
            data: test.data,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return results;
  }

  async runAllTests(directory: string): Promise<TestResults> {
    const totals: TestResults = {
      total: 0,
      passed: 0,
      failed: 0,
      failedTests: [],
    };

    for await (const entry of Deno.readDir(directory)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        const filePath = `${directory}/${entry.name}`;
        const results = await this.runTestFile(filePath);

        totals.total += results.total;
        totals.passed += results.passed;
        totals.failed += results.failed;
        totals.failedTests.push(...results.failedTests);
      }
    }

    return totals;
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  const runner = new TestSuiteRunner();
  const target = Deno.args[0] || "./test-suite/tests/draft2020-12";

  const stat = await Deno.stat(target);
  let results: TestResults;
  if (stat.isFile) {
    console.log(`Running JSON Schema test file: ${target}`);
    results = await runner.runTestFile(target);
  } else {
    console.log(`Running JSON Schema test suite from: ${target}`);
    results = await runner.runAllTests(target);
  }

  console.log("\n=== Test Results ===");
  console.log(`Total: ${results.total}`);
  console.log(
    `Passed: ${results.passed} (${
      (results.passed / results.total * 100).toFixed(2)
    }%)`,
  );
  console.log(`Failed: ${results.failed}`);

  if (results.failed > 0) {
    // Group failures by test group for readability
    const byGroup = new Map<string, number>();
    for (const f of results.failedTests) {
      byGroup.set(f.group, (byGroup.get(f.group) ?? 0) + 1);
    }
    const sorted = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n=== Failed Groups (${sorted.length} groups) ===`);
    for (const [group, count] of sorted) {
      console.log(`  ${count}x  ${group}`);
    }

    console.log("\n=== All Failed Tests ===");
    for (const failed of results.failedTests) {
      console.log(`\n${failed.group} - ${failed.test}`);
      console.log(`Expected: ${failed.expected}, Actual: ${failed.actual}`);
      if (failed.error) {
        console.log(`Error: ${failed.error}`);
      }
    }
  }
}
