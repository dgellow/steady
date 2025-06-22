/**
 * JSON Schema Test Suite Runner
 * Runs the official JSON Schema test suite against our validator
 */

import { JsonSchemaValidator } from "./validator.ts";
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
  }>;
}

export class TestSuiteRunner {
  private validator = new JsonSchemaValidator();

  async runTestFile(filePath: string): Promise<TestResults> {
    const content = await Deno.readTextFile(filePath);
    const testGroups: TestGroup[] = JSON.parse(content);
    
    const results: TestResults = {
      total: 0,
      passed: 0,
      failed: 0,
      failedTests: []
    };

    for (const group of testGroups) {
      for (const test of group.tests) {
        results.total++;
        
        const actual = this.validateTest(group.schema, test.data);
        
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
            data: test.data
          });
        }
      }
    }

    return results;
  }

  private validateTest(schema: Schema | boolean, data: unknown): boolean {
    try {
      // Handle boolean schemas
      if (typeof schema === "boolean") {
        return schema; // true = valid, false = invalid
      }

      const result = this.validator.validate(schema, data);
      return result.valid;
    } catch (error) {
      console.error("Validation error:", error);
      return false;
    }
  }

  async runAllTests(testDir: string): Promise<Map<string, TestResults>> {
    const results = new Map<string, TestResults>();
    
    for await (const entry of Deno.readDir(testDir)) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        const filePath = `${testDir}/${entry.name}`;
        try {
          const result = await this.runTestFile(filePath);
          results.set(entry.name, result);
        } catch (error) {
          console.error(`Failed to run test file ${entry.name}:`, error);
        }
      }
    }
    
    return results;
  }

  printSummary(results: Map<string, TestResults>): void {
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    console.log("\n=== JSON Schema Test Suite Results ===\n");

    for (const [file, result] of results) {
      totalTests += result.total;
      totalPassed += result.passed;
      totalFailed += result.failed;

      const passRate = result.total > 0 ? (result.passed / result.total * 100).toFixed(1) : '0.0';
      
      if (result.failed > 0) {
        console.log(`❌ ${file}: ${result.passed}/${result.total} (${passRate}%) - ${result.failed} failed`);
      } else {
        console.log(`✅ ${file}: ${result.passed}/${result.total} (${passRate}%)`);
      }
    }

    console.log(`\nOverall: ${totalPassed}/${totalTests} (${(totalPassed/totalTests*100).toFixed(1)}%)`);
    
    if (totalFailed > 0) {
      console.log(`\n🔴 ${totalFailed} tests failed`);
    } else {
      console.log(`\n🎉 All tests passed!`);
    }
  }

  printFailures(results: Map<string, TestResults>, maxFailures = 10): void {
    console.log("\n=== Failed Tests ===\n");
    
    let count = 0;
    for (const [file, result] of results) {
      if (result.failedTests.length === 0) continue;
      
      console.log(`\n--- ${file} ---`);
      
      for (const failure of result.failedTests) {
        if (count >= maxFailures) {
          console.log(`\n... and ${getTotalFailures(results) - maxFailures} more failures`);
          return;
        }
        
        console.log(`\n${failure.group} > ${failure.test}`);
        console.log(`  Expected: ${failure.expected}`);
        console.log(`  Actual: ${failure.actual}`);
        console.log(`  Schema: ${JSON.stringify(failure.schema)}`);
        console.log(`  Data: ${JSON.stringify(failure.data)}`);
        
        count++;
      }
    }
  }
}

function getTotalFailures(results: Map<string, TestResults>): number {
  let total = 0;
  for (const result of results.values()) {
    total += result.failedTests.length;
  }
  return total;
}

// CLI runner
if (import.meta.main) {
  const testDir = "./test-suite/tests/draft2020-12";
  const runner = new TestSuiteRunner();
  
  console.log("Running JSON Schema Test Suite...");
  const results = await runner.runAllTests(testDir);
  
  runner.printSummary(results);
  runner.printFailures(results);
}