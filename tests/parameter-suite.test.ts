/**
 * Parameter Suite Tests
 *
 * Comprehensive tests for parameter handling edge cases:
 * - Nested deepObject style query params (filter[meta][level]=1)
 * - Header arrays with simple style (X-Flags: F1, F2)
 * - Boolean values as strings in request bodies
 * - Array query params with repeat/comma/brackets styles
 * - Date/time/datetime format validation
 * - Integer request body (not object)
 * - Mixed path params with versions in path
 * - Form-data with nested objects
 * - Pagination with defaults and constraints
 * - Cookie parameters
 * - oneOf with discriminator
 * - Nullable types
 */

import { parseSpecFromFile } from "../packages/openapi/mod.ts";
import { MockServer } from "../src/server.ts";
import { assertEquals, assertExists } from "@std/assert";

const SPEC_PATH = "./tests/specs/parameter-suite.yaml";
const BASE_PORT = 4000; // Use different port range to avoid conflicts

// Helper to get a unique port for each test
let portCounter = 0;
function getPort(): number {
  return BASE_PORT + portCounter++;
}

// =============================================================================
// /count - Integer body
// =============================================================================

Deno.test({
  name: "Parameter Suite: PUT /count - integer body accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/count`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "42",
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Integer body accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: PUT /count - invalid integer body rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // String instead of integer
      const response = await fetch(`http://localhost:${port}/count`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: '"not a number"',
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Invalid integer body rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /json-v{version}/users/{userId} - JSON endpoint with mixed params
// =============================================================================

Deno.test({
  name: "Parameter Suite: POST /json-v{version}/users/{userId} - valid request",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
      validator: {
        queryObjectFormat: "brackets",
      },
    });

    server.start();

    try {
      const url = new URL(`http://localhost:${port}/json-v5/users/abc`);
      url.searchParams.set("date", "2025-01-02");
      url.searchParams.set("time", "15:04:00");
      url.searchParams.set("datetime", "2026-01-02T15:04:05Z");
      url.searchParams.set("limit", "123");
      url.searchParams.append("tags", "x");
      url.searchParams.append("tags", "y");

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": "TRACEID123",
        },
        body: JSON.stringify({
          blorp: "zux",
          preferences: { theme: "dark", alerts: true },
        }),
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Valid JSON endpoint request accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name:
    "Parameter Suite: POST /json-v{version}/users/{userId} - path param type validation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // Invalid version (not an integer-parsable path segment)
      const url =
        `http://localhost:${port}/json-vXYZ/users/abc?date=2025-01-02&time=15:04:00&datetime=2026-01-02T15:04:05Z`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      // NaN path param should fail validation
      assertEquals(response.status, 400);
      await response.text();
      console.log("✅ Invalid path parameter type rejected");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name:
    "Parameter Suite: POST /json-v{version}/users/{userId} - missing required query params",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // Missing required date, time, datetime params
      const response = await fetch(
        `http://localhost:${port}/json-v5/users/abc`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      assertEquals(data.errors.length >= 3, true); // At least date, time, datetime missing
      console.log("✅ Missing required query params rejected");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name:
    "Parameter Suite: POST /json-v{version}/users/{userId} - body boolean validation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const url =
        `http://localhost:${port}/json-v5/users/abc?date=2025-01-02&time=15:04:00&datetime=2026-01-02T15:04:05Z`;

      // alerts should be boolean, not string
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blorp: "zux",
          preferences: { theme: "gray", alerts: "no" }, // "no" is string, not boolean
        }),
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      // Should have error about alerts type
      const alertsError = data.errors.find((e: { path: string }) =>
        e.path.includes("alerts")
      );
      assertExists(alertsError);
      console.log("✅ String passed as boolean rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /paginated - Pagination with defaults
// =============================================================================

Deno.test({
  name: "Parameter Suite: GET /paginated - default values work",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // No page/size params - should use defaults
      const response = await fetch(`http://localhost:${port}/paginated`);

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Pagination defaults work");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /paginated - custom page and size",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(
        `http://localhost:${port}/paginated?page=2&size=25`,
      );

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Custom pagination params accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /paginated - size exceeds max rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // size > 100 should fail
      const response = await fetch(
        `http://localhost:${port}/paginated?size=999`,
      );

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Size exceeding maximum rejected");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /paginated - array tags param",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // Repeated tags
      const response = await fetch(
        `http://localhost:${port}/paginated?tags=foo&tags=bar&tags=baz`,
      );

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Array query param (repeat style) accepted");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /ping - Empty body
// =============================================================================

Deno.test({
  name: "Parameter Suite: POST /ping - no body required",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/ping`, {
        method: "POST",
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Empty body endpoint works");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /bulk - Array body
// =============================================================================

Deno.test({
  name: "Parameter Suite: POST /bulk - array body accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { foo: "item1", baz: 1 },
          { foo: "item2", baz: 2 },
        ]),
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Array body accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: POST /bulk - empty array rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // minItems: 1, so empty array should fail
      const response = await fetch(`http://localhost:${port}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Empty array body rejected (minItems: 1)");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: POST /bulk - invalid item schema rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // Missing required field "baz"
      const response = await fetch(`http://localhost:${port}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ foo: "item1" }]), // Missing baz
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Invalid item in array body rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /nullable - Nullable types
// =============================================================================

Deno.test({
  name:
    "Parameter Suite: POST /nullable - null value accepted for nullable field",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/nullable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requiredField: "test",
          optionalNullable: null,
        }),
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Null value accepted for nullable field");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: POST /nullable - missing required field rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/nullable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionalNullable: "test",
        }),
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Missing required field rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /events - oneOf with discriminator
// =============================================================================

Deno.test({
  name: "Parameter Suite: POST /events - click event accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "click",
          x: 100,
          y: 200,
          element: "button",
        }),
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Click event (oneOf) accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: POST /events - view event accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "view",
          page: "/home",
          duration: 5000,
        }),
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ View event (oneOf) accepted");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /items/{item-id}/sub-items/{sub_item_id} - Path with special chars
// =============================================================================

Deno.test({
  name:
    "Parameter Suite: GET /items/{item-id}/sub-items/{sub_item_id} - hyphen and underscore in param names",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(
        `http://localhost:${port}/items/abc-123/sub-items/456`,
      );

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Path params with hyphens and underscores work");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /search - Query with enum array
// =============================================================================

Deno.test({
  name: "Parameter Suite: GET /search - enum array query param",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(
        `http://localhost:${port}/search?q=test&status=draft&status=published&sort=asc`,
      );

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Enum array query param accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /search - invalid enum value rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // "invalid" is not in enum [draft, published, archived]
      const response = await fetch(
        `http://localhost:${port}/search?q=test&status=invalid`,
      );

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Invalid enum value rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// /session - Cookie parameters
// =============================================================================

Deno.test({
  name: "Parameter Suite: GET /session - valid cookie accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/session`, {
        headers: {
          Cookie: "session_id=0123456789abcdef0123456789abcdef; user_pref=dark",
        },
      });

      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Valid cookie params accepted");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /session - missing required cookie rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const response = await fetch(`http://localhost:${port}/session`);

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Missing required cookie rejected");
    } finally {
      server.stop();
    }
  },
});

Deno.test({
  name: "Parameter Suite: GET /session - invalid cookie pattern rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      // session_id pattern is ^[a-f0-9]{32}$ - this has uppercase
      const response = await fetch(`http://localhost:${port}/session`, {
        headers: {
          Cookie: "session_id=0123456789ABCDEF0123456789ABCDEF",
        },
      });

      assertEquals(response.status, 400);
      const data = await response.json();
      assertExists(data.errors);
      console.log("✅ Invalid cookie pattern rejected");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// Nested deepObject style tests
// =============================================================================

Deno.test({
  name:
    "Parameter Suite: Nested deepObject filter[meta][level] with brackets format",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
      validator: {
        queryObjectFormat: "brackets",
      },
    });

    server.start();

    try {
      const url = new URL(`http://localhost:${port}/json-v5/users/abc`);
      url.searchParams.set("date", "2025-01-02");
      url.searchParams.set("time", "15:04:00");
      url.searchParams.set("datetime", "2026-01-02T15:04:05Z");
      url.searchParams.set("limit", "123");
      url.searchParams.append("tags", "x");
      url.searchParams.append("tags", "y");
      // Nested deepObject params: filter[meta][level] should parse to {meta: {level: 1}}
      url.searchParams.set("filter[status]", "active");
      url.searchParams.set("filter[meta][level]", "1");

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": "TRACEID",
        },
        body: JSON.stringify({
          blorp: "zux",
          preferences: { theme: "dark", alerts: true },
        }),
      });

      // When nested deepObject is supported, this should return 200
      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Nested deepObject filter[meta][level] accepted");
    } finally {
      server.stop();
    }
  },
});

// =============================================================================
// Header array with simple style
// =============================================================================

Deno.test({
  name: "Parameter Suite: Header array with simple style (comma-separated)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const spec = await parseSpecFromFile(SPEC_PATH);
    const port = getPort();
    const server = new MockServer(spec, {
      port,
      host: "localhost",
      mode: "strict",
      verbose: false,
      logLevel: "summary",
      interactive: false,
    });

    server.start();

    try {
      const url = new URL(`http://localhost:${port}/json-v5/users/abc`);
      url.searchParams.set("date", "2025-01-02");
      url.searchParams.set("time", "15:04:00");
      url.searchParams.set("datetime", "2026-01-02T15:04:05Z");

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": "TRACE123",
          // Simple style array header - comma separated per OpenAPI spec
          "X-Flags": "F1, F2",
        },
        body: JSON.stringify({}),
      });

      // When header array parsing is supported, this should return 200
      assertEquals(response.status, 200);
      await response.text();
      console.log("✅ Header array with simple style accepted");
    } finally {
      server.stop();
    }
  },
});

console.log("Parameter Suite tests loaded");
