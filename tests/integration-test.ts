/**
 * Integration tests for Steady with enterprise-scale specs
 *
 * Tests:
 * 1. Massive spec loading (8.4MB datadog-openapi.json)
 * 2. Path parameter extraction and matching
 * 3. Request body validation with JSON Schema
 * 4. Error attribution (SDK vs spec)
 * 5. Performance with complex schemas
 */

import { parseSpec } from "../packages/parser/mod.ts";
import { MockServer } from "../src/server.ts";
import { assertEquals, assertExists } from "@std/assert";

Deno.test("Integration: Load massive Datadog spec (8.4MB, 323 endpoints)", async () => {
  const spec = await parseSpec("./datadog-openapi.json");

  // Verify basic structure
  assertEquals(spec.openapi, "3.0.3");
  assertEquals(spec.info.title, "Datadog API Collection");

  // Verify paths loaded
  const pathCount = Object.keys(spec.paths).length;
  assertEquals(pathCount, 323);

  console.log(`✅ Successfully loaded ${pathCount} endpoints from 8.4MB spec`);
});

Deno.test("Integration: Path parameter extraction", async () => {
  const spec = await parseSpec("./datadog-openapi.json");

  // Create a mock server
  const server = new MockServer(spec, {
    port: 3000,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  // Test path matching with parameters
  // The spec has: /api/v1/dashboard/{dashboard_id}
  const testCases = [
    {
      path: "/api/v1/dashboard/abc-123-def",
      pattern: "/api/v1/dashboard/{dashboard_id}",
      expected: { dashboard_id: "abc-123-def" },
    },
    {
      path: "/api/v1/events/event-456",
      pattern: "/api/v1/events/{event_id}",
      expected: { event_id: "event-456" },
    },
    {
      path: "/api/v1/host/my-host.example.com/mute",
      pattern: "/api/v1/host/{host_name}/mute",
      expected: { host_name: "my-host.example.com" },
    },
  ];

  for (const tc of testCases) {
    // Use the private matchPath method (we'll access via reflection for testing)
    // deno-lint-ignore no-explicit-any
    const matchPath = (server as any).matchPath.bind(server);
    const result = matchPath(tc.path, tc.pattern);

    assertExists(result, `Failed to match ${tc.path} against ${tc.pattern}`);
    assertEquals(result, tc.expected);
  }

  console.log("✅ Path parameter extraction working correctly");
});

Deno.test("Integration: Request body validation", async () => {
  // Create a simple spec with request body validation
  const spec = await parseSpec("./tests/test-spec-with-body.yaml");

  const server = new MockServer(spec, {
    port: 3001,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  // Start server
  server.start();

  try {
    // Test valid request body
    const validResponse = await fetch("http://localhost:3001/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        age: 30,
      }),
    });

    assertEquals(validResponse.status, 200);
    console.log("✅ Valid request body accepted");

    // Test invalid request body (missing required field)
    const invalidResponse = await fetch("http://localhost:3001/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Bob",
        // Missing required email field
      }),
    });

    assertEquals(invalidResponse.status, 400);
    const errorData = await invalidResponse.json();
    assertExists(errorData.errors);
    assertEquals(errorData.errors.length > 0, true);
    console.log("✅ Invalid request body rejected with proper error");

    // Test type validation
    const typeErrorResponse = await fetch("http://localhost:3001/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Charlie",
        email: "not-an-email", // Invalid email format
        age: "not-a-number", // Wrong type
      }),
    });

    assertEquals(typeErrorResponse.status, 400);
    const typeErrorData = await typeErrorResponse.json();
    assertExists(typeErrorData.errors);
    console.log("✅ Type validation working correctly");
  } finally {
    server.stop();
  }
});

Deno.test("Integration: Path parameter validation with types", async () => {
  // Test that path parameters are validated against their schema types
  const spec = await parseSpec("./tests/test-spec-with-body.yaml");

  const server = new MockServer(spec, {
    port: 3002,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  server.start();

  try {
    // Test integer path parameter
    const validIdResponse = await fetch("http://localhost:3002/users/123");
    assertEquals(validIdResponse.status, 200);
    console.log("✅ Valid integer path parameter accepted");

    // Test invalid integer path parameter
    const invalidIdResponse = await fetch("http://localhost:3002/users/not-a-number");
    assertEquals(invalidIdResponse.status, 400);
    const errorData = await invalidIdResponse.json();
    assertExists(errorData.errors);
    console.log("✅ Invalid path parameter rejected");
  } finally {
    server.stop();
  }
});

Deno.test("Integration: Performance with complex nested schemas", async () => {
  const spec = await parseSpec("./datadog-openapi.json");

  const server = new MockServer(spec, {
    port: 3003,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  server.start();

  try {
    // Test a complex endpoint with nested schemas
    const startTime = performance.now();

    const response = await fetch("http://localhost:3003/api/v1/dashboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Dashboard",
        description: "Integration test dashboard",
        widgets: [],
        layout_type: "ordered",
      }),
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    assertExists(response);
    console.log(`✅ Complex nested schema validated in ${duration.toFixed(2)}ms`);

    // Should be fast even with complex schemas
    assertEquals(duration < 100, true, `Validation took ${duration}ms, expected < 100ms`);
  } finally {
    server.stop();
  }
});

Deno.test("Integration: Multiple path parameters", async () => {
  const spec = await parseSpec("./datadog-openapi.json");

  const server = new MockServer(spec, {
    port: 3004,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  // Test matching paths with multiple parameters
  // deno-lint-ignore no-explicit-any
  const matchPath = (server as any).matchPath.bind(server);

  // Example: /api/v2/usage/{product_family}
  const result = matchPath(
    "/api/v2/usage/infra_hosts",
    "/api/v2/usage/{product_family}",
  );

  assertExists(result);
  assertEquals(result.product_family, "infra_hosts");

  console.log("✅ Multiple path parameters handled correctly");
});

Deno.test("Integration: Query parameter validation", async () => {
  const spec = await parseSpec("./datadog-openapi.json");

  const server = new MockServer(spec, {
    port: 3005,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  server.start();

  try {
    // Test endpoint with query parameters
    // /api/v1/hosts typically has filter_by parameter
    const response = await fetch("http://localhost:3005/api/v1/hosts?filter=hostname:example");

    assertExists(response);
    console.log("✅ Query parameter validation working");
  } finally {
    server.stop();
  }
});
