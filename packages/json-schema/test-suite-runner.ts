/**
 * Runner for the official JSON Schema test suite using the new processor
 */

import { JsonSchemaProcessor } from "./processor.ts";
import { SchemaValidator } from "./schema-validator.ts";
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
  private processor = new JsonSchemaProcessor();

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
      // Process the schema once
      const processResult = await this.processor.process(group.schema);

      if (!processResult.valid) {
        console.error(
          `Failed to process schema for group: ${group.description}`,
        );
        console.error(processResult.errors);
        continue;
      }

      const validator = new SchemaValidator(processResult.schema!);

      for (const test of group.tests) {
        results.total++;

        try {
          const validationResult = validator.validate(test.data);
          const actual = validationResult.valid;

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
              error: validationResult.errors[0]?.message,
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
  const testDir = Deno.args[0] || "./test-suite/tests/draft2020-12";

  console.log(`Running JSON Schema test suite from: ${testDir}`);
  const results = await runner.runAllTests(testDir);

  console.log("\n=== Test Results ===");
  console.log(`Total: ${results.total}`);
  console.log(
    `Passed: ${results.passed} (${
      (results.passed / results.total * 100).toFixed(2)
    }%)`,
  );
  console.log(`Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log("\n=== Failed Tests (first 10) ===");
    for (const failed of results.failedTests.slice(0, 10)) {
      console.log(`\n${failed.group} - ${failed.test}`);
      console.log(`Expected: ${failed.expected}, Actual: ${failed.actual}`);
      if (failed.error) {
        console.log(`Error: ${failed.error}`);
      }
    }
  }
}
