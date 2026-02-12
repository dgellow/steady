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
