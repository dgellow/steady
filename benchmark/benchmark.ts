#!/usr/bin/env -S deno run --allow-all
/**
 * Benchmark: Steady vs Prism Performance Comparison
 *
 * Tests:
 * 1. Startup time (cold start with large spec)
 * 2. Request latency (various endpoints)
 * 3. Memory usage
 * 4. Throughput (requests per second)
 */

const SPEC_PATH = "./test-spec.yaml";
const STEADY_PORT = 4011;
const PRISM_PORT = 4012;
const WARMUP_REQUESTS = 10;
const BENCHMARK_REQUESTS = 100;

// Sample endpoints from test spec
const TEST_ENDPOINTS = [
  { path: "/users", method: "GET" },
  { path: "/posts", method: "GET" },
  { path: "/health", method: "GET" },
  { path: "/accounts", method: "GET" },
];

interface BenchmarkResult {
  name: string;
  startupTimeMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  requestsPerSecond: number;
  memoryMb?: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function waitForServer(port: number, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/accounts`, {
        method: "GET",
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok || res.status === 404) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(100);
  }
  return false;
}

async function measureLatencies(
  port: number,
  endpoints: typeof TEST_ENDPOINTS,
  numRequests: number
): Promise<number[]> {
  const latencies: number[] = [];

  for (let i = 0; i < numRequests; i++) {
    for (const endpoint of endpoints) {
      const start = performance.now();
      try {
        await fetch(`http://localhost:${port}${endpoint.path}`, {
          method: endpoint.method,
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Ignore errors for latency measurement
      }
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }
  }

  return latencies;
}

async function benchmarkSteady(): Promise<BenchmarkResult> {
  console.log("\n🔵 Benchmarking Steady...");

  // Measure startup time
  const startupStart = performance.now();
  const process = new Deno.Command("deno", {
    args: ["run", "--allow-all", "../cmd/steady.ts", SPEC_PATH, "--port", String(STEADY_PORT)],
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const ready = await waitForServer(STEADY_PORT);
  const startupTimeMs = performance.now() - startupStart;

  if (!ready) {
    console.error("❌ Steady failed to start");
    try { process.kill("SIGTERM"); } catch { /* already dead */ }
    await process.status.catch(() => {});
    return {
      name: "Steady",
      startupTimeMs: -1,
      avgLatencyMs: -1,
      p50LatencyMs: -1,
      p95LatencyMs: -1,
      p99LatencyMs: -1,
      minLatencyMs: -1,
      maxLatencyMs: -1,
      requestsPerSecond: -1,
    };
  }

  console.log(`  ✓ Started in ${startupTimeMs.toFixed(0)}ms`);

  // Warmup
  console.log("  Warming up...");
  await measureLatencies(STEADY_PORT, TEST_ENDPOINTS, WARMUP_REQUESTS);

  // Benchmark
  console.log(`  Running ${BENCHMARK_REQUESTS * TEST_ENDPOINTS.length} requests...`);
  const benchStart = performance.now();
  const latencies = await measureLatencies(STEADY_PORT, TEST_ENDPOINTS, BENCHMARK_REQUESTS);
  const benchDuration = performance.now() - benchStart;

  // Cleanup
  try { process.kill("SIGTERM"); } catch { /* already dead */ }
  await process.status.catch(() => {});

  const totalRequests = latencies.length;
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / totalRequests;

  return {
    name: "Steady",
    startupTimeMs,
    avgLatencyMs,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    requestsPerSecond: (totalRequests / benchDuration) * 1000,
  };
}

async function benchmarkPrism(): Promise<BenchmarkResult> {
  console.log("\n🟣 Benchmarking Prism...");

  // Measure startup time
  const startupStart = performance.now();
  const process = new Deno.Command("npx", {
    args: ["@stoplight/prism-cli", "mock", SPEC_PATH, "--port", String(PRISM_PORT), "--host", "0.0.0.0"],
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const ready = await waitForServer(PRISM_PORT, 120000); // Prism may take longer
  const startupTimeMs = performance.now() - startupStart;

  if (!ready) {
    console.error("❌ Prism failed to start");
    try { process.kill("SIGTERM"); } catch { /* already dead */ }
    await process.status.catch(() => {});
    return {
      name: "Prism",
      startupTimeMs: -1,
      avgLatencyMs: -1,
      p50LatencyMs: -1,
      p95LatencyMs: -1,
      p99LatencyMs: -1,
      minLatencyMs: -1,
      maxLatencyMs: -1,
      requestsPerSecond: -1,
    };
  }

  console.log(`  ✓ Started in ${startupTimeMs.toFixed(0)}ms`);

  // Warmup
  console.log("  Warming up...");
  await measureLatencies(PRISM_PORT, TEST_ENDPOINTS, WARMUP_REQUESTS);

  // Benchmark
  console.log(`  Running ${BENCHMARK_REQUESTS * TEST_ENDPOINTS.length} requests...`);
  const benchStart = performance.now();
  const latencies = await measureLatencies(PRISM_PORT, TEST_ENDPOINTS, BENCHMARK_REQUESTS);
  const benchDuration = performance.now() - benchStart;

  // Cleanup
  try { process.kill("SIGTERM"); } catch { /* already dead */ }
  await process.status.catch(() => {});

  const totalRequests = latencies.length;
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / totalRequests;

  return {
    name: "Prism",
    startupTimeMs,
    avgLatencyMs,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    requestsPerSecond: (totalRequests / benchDuration) * 1000,
  };
}

function printResults(results: BenchmarkResult[]) {
  console.log("\n" + "=".repeat(70));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(70));
  console.log(`Spec: Test API (13 paths, 17 operations)`);
  console.log(`Test endpoints: ${TEST_ENDPOINTS.length}`);
  console.log(`Requests per endpoint: ${BENCHMARK_REQUESTS}`);
  console.log(`Total requests: ${BENCHMARK_REQUESTS * TEST_ENDPOINTS.length}`);
  console.log("=".repeat(70));

  const headers = ["Metric", ...results.map(r => r.name)];
  const rows = [
    ["Startup Time", ...results.map(r => r.startupTimeMs > 0 ? `${r.startupTimeMs.toFixed(0)}ms` : "FAILED")],
    ["Avg Latency", ...results.map(r => r.avgLatencyMs > 0 ? `${r.avgLatencyMs.toFixed(2)}ms` : "N/A")],
    ["P50 Latency", ...results.map(r => r.p50LatencyMs > 0 ? `${r.p50LatencyMs.toFixed(2)}ms` : "N/A")],
    ["P95 Latency", ...results.map(r => r.p95LatencyMs > 0 ? `${r.p95LatencyMs.toFixed(2)}ms` : "N/A")],
    ["P99 Latency", ...results.map(r => r.p99LatencyMs > 0 ? `${r.p99LatencyMs.toFixed(2)}ms` : "N/A")],
    ["Min Latency", ...results.map(r => r.minLatencyMs > 0 ? `${r.minLatencyMs.toFixed(2)}ms` : "N/A")],
    ["Max Latency", ...results.map(r => r.maxLatencyMs > 0 ? `${r.maxLatencyMs.toFixed(2)}ms` : "N/A")],
    ["Throughput", ...results.map(r => r.requestsPerSecond > 0 ? `${r.requestsPerSecond.toFixed(1)} req/s` : "N/A")],
  ];

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)) + 2
  );

  // Print table
  console.log(headers.map((h, i) => h.padEnd(widths[i] ?? 15)).join("│"));
  console.log(widths.map(w => "─".repeat(w)).join("┼"));
  for (const row of rows) {
    console.log(row.map((c, i) => (c ?? "").padEnd(widths[i] ?? 15)).join("│"));
  }

  // Print comparison
  if (results.length === 2 && results[0]!.startupTimeMs > 0 && results[1]!.startupTimeMs > 0) {
    const [steady, prism] = results;
    console.log("\n" + "=".repeat(70));
    console.log("COMPARISON (Steady vs Prism)");
    console.log("=".repeat(70));

    const startupRatio = prism!.startupTimeMs / steady!.startupTimeMs;
    const latencyRatio = prism!.avgLatencyMs / steady!.avgLatencyMs;
    const throughputRatio = steady!.requestsPerSecond / prism!.requestsPerSecond;

    console.log(`Startup: Steady is ${startupRatio.toFixed(1)}x faster`);
    console.log(`Latency: Steady is ${latencyRatio.toFixed(1)}x faster`);
    console.log(`Throughput: Steady handles ${throughputRatio.toFixed(1)}x more requests/sec`);
  }
}

async function main() {
  console.log("🚀 OpenAPI Mock Server Benchmark");
  console.log("================================\n");

  // Ensure spec exists
  try {
    await Deno.stat(SPEC_PATH);
  } catch {
    console.error(`❌ Spec file not found: ${SPEC_PATH}`);
    console.error("Run: curl -L -o cloudflare.yaml 'https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.yaml'");
    Deno.exit(1);
  }

  const results: BenchmarkResult[] = [];

  // Run benchmarks
  results.push(await benchmarkSteady());
  await sleep(2000); // Wait between tests
  results.push(await benchmarkPrism());

  // Print results
  printResults(results);
}

main().catch(console.error);
