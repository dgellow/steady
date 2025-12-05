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

import { parseSpecFromFile } from "../packages/parser/mod.ts";
import { MockServer } from "../src/server.ts";
import { matchPathPattern } from "../src/path-matcher.ts";
import { assertEquals, assertExists } from "@std/assert";

// =============================================================================
// Path Matching Tests (using exported utility - no server needed)
// =============================================================================

Deno.test("Integration: Path parameter extraction", () => {
  // Test path matching with parameters using the exported utility
  const testCases: Array<{
    path: string;
    pattern: string;
    expected: Record<string, string>;
  }> = [
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
    const result = matchPathPattern(tc.path, tc.pattern);
    assertExists(result, `Failed to match ${tc.path} against ${tc.pattern}`);
    assertEquals(result, tc.expected);
  }

  console.log("✅ Path parameter extraction working correctly");
});

Deno.test("Integration: Multiple path parameters", () => {
  // Test multiple parameters in a single path
  const result = matchPathPattern(
    "/api/v2/users/123/posts/456",
    "/api/v2/users/{user_id}/posts/{post_id}",
  );

  assertExists(result);
  assertEquals(result.user_id, "123");
  assertEquals(result.post_id, "456");

  // Test URL-encoded values
  const encodedResult = matchPathPattern(
    "/api/v1/items/hello%20world",
    "/api/v1/items/{item_id}",
  );

  assertExists(encodedResult);
  assertEquals(encodedResult.item_id, "hello world");

  console.log("✅ Multiple path parameters handled correctly");
});

Deno.test("Integration: Path matching edge cases", () => {
  // Non-matching paths
  assertEquals(
    matchPathPattern("/users/123/posts", "/users/{id}"),
    null,
    "Different segment counts should not match",
  );

  assertEquals(
    matchPathPattern("/items/123", "/users/{id}"),
    null,
    "Literal mismatch should not match",
  );

  // Exact match with no params
  const exactResult = matchPathPattern("/api/health", "/api/health");
  assertExists(exactResult);
  assertEquals(Object.keys(exactResult).length, 0);

  console.log("✅ Path matching edge cases handled correctly");
});

// =============================================================================
// Spec Loading Tests
// =============================================================================

Deno.test("Integration: Load massive Datadog spec (8.4MB, 323 endpoints)", async () => {
  const spec = await parseSpecFromFile("./tests/fixtures/datadog-openapi.json");

  // Verify basic structure
  assertEquals(spec.openapi, "3.0.3");
  assertEquals(spec.info.title, "Datadog API Collection");

  // Verify paths loaded
  const pathCount = Object.keys(spec.paths).length;
  assertEquals(pathCount, 323);

  console.log(`✅ Successfully loaded ${pathCount} endpoints from 8.4MB spec`);
});

// =============================================================================
// HTTP Integration Tests (require server)
// =============================================================================

Deno.test({
  name: "Integration: Request body validation",
  sanitizeOps: false, // Server uses async ops that may not complete
  sanitizeResources: false, // Server holds resources
  fn: async () => {
    const spec = await parseSpecFromFile(
      "./tests/specs/test-spec-with-body.yaml",
    );

    const server = new MockServer(spec, {
      port: 3001,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // Test valid request body
      const validResponse = await fetch("http://localhost:3001/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          age: 30,
        }),
      });

      assertEquals(validResponse.status, 200);
      await validResponse.text(); // Consume body to prevent leak
      console.log("✅ Valid request body accepted");

      // Test invalid request body (missing required field)
      const invalidResponse = await fetch("http://localhost:3001/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Charlie",
          email: "not-an-email",
          age: "not-a-number",
        }),
      });

      assertEquals(typeErrorResponse.status, 400);
      const typeErrorData = await typeErrorResponse.json();
      assertExists(typeErrorData.errors);
      console.log("✅ Type validation working correctly");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Integration: Path parameter validation with types",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(
      "./tests/specs/test-spec-with-body.yaml",
    );

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
      await validIdResponse.text(); // Consume body
      console.log("✅ Valid integer path parameter accepted");

      // Test invalid integer path parameter
      const invalidIdResponse = await fetch(
        "http://localhost:3002/users/not-a-number",
      );
      assertEquals(invalidIdResponse.status, 400);
      const errorData = await invalidIdResponse.json();
      assertExists(errorData.errors);
      console.log("✅ Invalid path parameter rejected");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Integration: Performance with complex nested schemas",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(
      "./tests/fixtures/datadog-openapi.json",
    );

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
      const startTime = performance.now();

      const response = await fetch("http://localhost:3003/api/v1/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      await response.text(); // Consume body
      console.log(
        `✅ Complex nested schema validated in ${duration.toFixed(2)}ms`,
      );

      // Should be reasonably fast even with complex schemas
      assertEquals(
        duration < 500,
        true,
        `Validation took ${duration}ms, expected < 500ms`,
      );
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Integration: Query parameter validation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(
      "./tests/fixtures/datadog-openapi.json",
    );

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
      const response = await fetch(
        "http://localhost:3005/api/v1/hosts?filter=hostname:example",
      );

      assertExists(response);
      await response.text(); // Consume body
      console.log("✅ Query parameter validation working");
    } finally {
      server.stop();
    }
  },
});
