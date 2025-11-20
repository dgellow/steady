/**
 * Performance benchmark for JSON Schema validator
 * Tests data-oriented design principles
 */

import { JsonSchemaValidator } from "./validator.ts";
import type { Schema } from "./types.ts";

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  opsPerSec: number;
  memoryUsed?: number;
}

class Benchmark {
  private validator = new JsonSchemaValidator();

  // Generate test data
  private generateLargeObject(size: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < size; i++) {
      obj[`prop${i}`] = {
        id: i,
        name: `Item ${i}`,
        tags: [`tag${i}`, `category${i % 10}`],
        metadata: {
          created: new Date().toISOString(),
          active: i % 2 === 0,
          score: Math.random() * 100
        }
      };
    }
    return obj;
  }

  private generateComplexSchema(): Schema {
    return {
      type: "object",
      properties: {
        id: { type: "integer", minimum: 0 },
        name: { type: "string", minLength: 1, maxLength: 100 },
        tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          uniqueItems: true
        },
        metadata: {
          type: "object",
          properties: {
            created: { type: "string", format: "date-time" },
            active: { type: "boolean" },
            score: { type: "number", minimum: 0, maximum: 100 }
          },
          required: ["created", "active"]
        }
      },
      required: ["id", "name"],
      additionalProperties: false
    };
  }

  runBenchmark(
    name: string,
    schema: Schema,
    data: unknown,
    iterations: number = 1000
  ): BenchmarkResult {
    // Warm up
    for (let i = 0; i < 10; i++) {
      this.validator.validate(schema, data);
    }

    // Force garbage collection if available
    if (globalThis.gc) {
      globalThis.gc();
    }

    const memBefore = this.getMemoryUsage();
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      this.validator.validate(schema, data);
    }

    const endTime = performance.now();
    const memAfter = this.getMemoryUsage();

    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;
    const opsPerSec = 1000 / avgTime;

    return {
      name,
      iterations,
      totalTime,
      avgTime,
      opsPerSec,
      memoryUsed: memAfter - memBefore
    };
  }

  private getMemoryUsage(): number {
    // Deno-specific memory usage
    try {
      return (Deno as { memoryUsage?: () => { heapUsed: number } }).memoryUsage?.().heapUsed || 0;
    } catch {
      return 0;
    }
  }

  runAllBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];

    console.log("🚀 Starting JSON Schema Validator Benchmarks...\n");

    // Simple validation
    const simpleSchema: Schema = { type: "string", minLength: 5 };
    const simpleData = "hello world";
    results.push(this.runBenchmark("Simple string validation", simpleSchema, simpleData, 10000));

    // Complex object validation
    const complexSchema = this.generateComplexSchema();
    const complexData = this.generateLargeObject(1);
    results.push(this.runBenchmark("Complex object validation", complexSchema, complexData, 1000));

    // Large object validation
    const largeSchema: Schema = {
      type: "object",
      patternProperties: {
        "^prop\\d+$": this.generateComplexSchema()
      },
      additionalProperties: false
    };
    const largeData = this.generateLargeObject(100);
    results.push(this.runBenchmark("Large object (100 props)", largeSchema, largeData, 100));

    // Array with uniqueItems (expensive)
    const arraySchema: Schema = {
      type: "array",
      items: { type: "object" },
      uniqueItems: true
    };
    const arrayData = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item${i}` }));
    results.push(this.runBenchmark("Array uniqueItems (1000 items)", arraySchema, arrayData, 10));

    // Deep nesting
    let deepSchema: Schema = { type: "string" };
    for (let i = 0; i < 50; i++) {
      deepSchema = {
        type: "object",
        properties: { nested: deepSchema },
        required: ["nested"]
      };
    }
    let deepData: unknown = "deep value";
    for (let i = 0; i < 50; i++) {
      deepData = { nested: deepData };
    }
    results.push(this.runBenchmark("Deep nesting (50 levels)", deepSchema, deepData, 100));

    return results;
  }

  printResults(results: BenchmarkResult[]): void {
    console.log("📊 Benchmark Results:\n");
    console.log("| Test | Ops/sec | Avg Time | Memory |");
    console.log("|------|---------|----------|--------|");

    for (const result of results) {
      const opsPerSec = result.opsPerSec.toFixed(0).padStart(7);
      const avgTime = `${result.avgTime.toFixed(2)}ms`.padStart(8);
      const memory = result.memoryUsed ? `${(result.memoryUsed / 1024 / 1024).toFixed(1)}MB` : "N/A";
      
      console.log(`| ${result.name.padEnd(35)} | ${opsPerSec} | ${avgTime} | ${memory.padStart(6)} |`);
    }

    console.log("\n🎯 Performance Analysis:");
    
    const slowestTest = results.reduce((prev, curr) => 
      prev.opsPerSec < curr.opsPerSec ? prev : curr
    );
    
    console.log(`🐌 Slowest: ${slowestTest.name} (${slowestTest.opsPerSec.toFixed(0)} ops/sec)`);
    
    const fastestTest = results.reduce((prev, curr) => 
      prev.opsPerSec > curr.opsPerSec ? prev : curr
    );
    
    console.log(`⚡ Fastest: ${fastestTest.name} (${fastestTest.opsPerSec.toFixed(0)} ops/sec)`);
    
    // Check for performance issues
    const uniqueItemsResult = results.find(r => r.name.includes("uniqueItems"));
    if (uniqueItemsResult && uniqueItemsResult.opsPerSec < 100) {
      console.log("⚠️  uniqueItems validation is slow - consider optimization");
    }
    
    const deepNestingResult = results.find(r => r.name.includes("Deep nesting"));
    if (deepNestingResult && deepNestingResult.opsPerSec < 1000) {
      console.log("⚠️  Deep nesting is slow - consider iterative approach");
    }
  }
}

if (import.meta.main) {
  const benchmark = new Benchmark();
  const results = benchmark.runAllBenchmarks();
  benchmark.printResults(results);
}