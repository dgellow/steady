import { assertEquals } from "@std/assert";
import { DiagnosticCollector } from "./collector.ts";

Deno.test("getCoverage returns untested endpoints", () => {
  const collector = new DiagnosticCollector();
  collector.setAllEndpoints([
    "GET /users",
    "POST /users",
    "GET /users/{id}",
    "DELETE /users/{id}",
    "GET /health",
  ]);

  // Only test 2 of 5 endpoints
  collector.trackEndpoint("GET", "/users");
  collector.trackEndpoint("GET", "/health");

  const coverage = collector.getCoverage();
  assertEquals(coverage.tested, 2);
  assertEquals(coverage.total, 5);
  assertEquals(coverage.untestedEndpoints, [
    "POST /users",
    "GET /users/{id}",
    "DELETE /users/{id}",
  ]);
});

Deno.test("getCoverage with no requests returns all endpoints as untested", () => {
  const collector = new DiagnosticCollector();
  collector.setAllEndpoints(["GET /a", "POST /b"]);

  const coverage = collector.getCoverage();
  assertEquals(coverage.tested, 0);
  assertEquals(coverage.total, 2);
  assertEquals(coverage.untestedEndpoints, ["GET /a", "POST /b"]);
});

Deno.test("getCoverage with all endpoints tested returns empty untested", () => {
  const collector = new DiagnosticCollector();
  collector.setAllEndpoints(["GET /a", "POST /b"]);
  collector.trackEndpoint("GET", "/a");
  collector.trackEndpoint("POST", "/b");

  const coverage = collector.getCoverage();
  assertEquals(coverage.tested, 2);
  assertEquals(coverage.total, 2);
  assertEquals(coverage.untestedEndpoints, []);
});

// ── Generation warnings ──────────────────────────────────────────────

Deno.test("trackGenerationWarning accumulates warnings", () => {
  const collector = new DiagnosticCollector();
  collector.trackGenerationWarning("POST", "/users");
  assertEquals(collector.getGenerationWarnings(), ["POST /users"]);
});

Deno.test("trackGenerationWarning - multiple warnings accumulate", () => {
  const collector = new DiagnosticCollector();
  collector.trackGenerationWarning("POST", "/users");
  collector.trackGenerationWarning("GET", "/items");
  collector.trackGenerationWarning("PUT", "/orders/{id}");
  assertEquals(collector.getGenerationWarnings(), [
    "POST /users",
    "GET /items",
    "PUT /orders/{id}",
  ]);
});

Deno.test("resetRuntime clears all runtime state", () => {
  const collector = new DiagnosticCollector();
  collector.setAllEndpoints(["GET /users", "POST /users"]);

  // Populate all runtime fields
  collector.addRuntimeDiagnostics(
    [{
      code: "E3001",
      severity: "error",
      category: "sdk-issue",
      requestPath: "",
      specPointer: "",
      message: "test",
      attribution: { confidence: 1.0, reasoning: ["test"] },
    }],
    "GET",
    "/users",
    false,
  );
  collector.trackEndpoint("GET", "/users");
  collector.trackGenerationWarning("POST", "/users");

  // Verify populated
  assertEquals(collector.getRuntimeDiagnostics().length, 1);
  assertEquals(collector.getCoverage().tested, 1);
  assertEquals(collector.getGenerationWarnings().length, 1);
  assertEquals(collector.getStats().requestCount, 1);

  collector.resetRuntime();

  // Verify all cleared
  assertEquals(collector.getRuntimeDiagnostics(), []);
  assertEquals(collector.getCoverage().tested, 0);
  assertEquals(collector.getGenerationWarnings(), []);
  assertEquals(collector.getStats().requestCount, 0);
  // allEndpoints should NOT be cleared (it's startup data)
  assertEquals(collector.getCoverage().total, 2);
});
