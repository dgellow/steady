/**
 * Tests for MockServer
 *
 * Covers:
 * - Route matching (exact and parameterized paths)
 * - Response generation from examples
 * - X-Steady-Mode header (per-request validation mode)
 * - Validation error responses
 * - Special endpoints (health, spec)
 */

import { assertEquals, assertExists } from "@std/assert";
import { MockServer } from "./server.ts";
import { parseSpecFromFile } from "../packages/openapi/mod.ts";

const TEST_SPEC_PATH = "./tests/specs/test-api.yaml";

// Server tests use signal handlers for graceful shutdown, which causes leak detection to fail.
// Disable sanitizers for these integration tests.
const serverTestOpts = { sanitizeOps: false, sanitizeResources: false };

/** Helper to create a server and ensure cleanup */
async function withServer(
  opts: { mode?: "strict" | "relaxed"; port?: number },
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const spec = await parseSpecFromFile(TEST_SPEC_PATH);
  const port = opts.port ?? 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    mode: opts.mode ?? "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
  });

  server.start();
  // Give server time to start
  await new Promise((r) => setTimeout(r, 10));
  try {
    await fn(server, `http://localhost:${port}`);
  } finally {
    server.stop();
    // Give server time to cleanup
    await new Promise((r) => setTimeout(r, 10));
  }
}

// =============================================================================
// Route Matching
// =============================================================================

Deno.test(
  { name: "Server: matches exact paths", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertExists(data);
      assertEquals(Array.isArray(data), true);
    });
  },
);

Deno.test(
  { name: "Server: matches parameterized paths", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users/123`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(data.id, 1); // From example
    });
  },
);

Deno.test(
  { name: "Server: returns 404 for unknown paths", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/unknown/path`);
      assertEquals(response.status, 404);

      const data = await response.json();
      assertExists(data.error);
    });
  },
);

Deno.test({
  name: "Server: returns 404 for wrong HTTP method",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users/123`, { method: "DELETE" });
    assertEquals(response.status, 404);
    await response.body?.cancel();
  });
});

// =============================================================================
// Response Generation
// =============================================================================

Deno.test(
  { name: "Server: returns example from spec", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(data.status, "ok");
    });
  },
);

Deno.test({
  name: "Server: includes X-Steady-Matched-Path header",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users/456`);
    assertEquals(response.status, 200);

    const matchedPath = response.headers.get("X-Steady-Matched-Path");
    assertEquals(matchedPath, "/users/{id}");
    await response.body?.cancel();
  });
});

// =============================================================================
// X-Steady-Mode Header
// =============================================================================

Deno.test({
  name: "Server: X-Steady-Mode header in response (strict server)",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`);
    assertEquals(response.status, 200);

    const mode = response.headers.get("X-Steady-Mode");
    assertEquals(mode, "strict");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady-Mode header in response (relaxed server)",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "relaxed" }, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`);
    assertEquals(response.status, 200);

    const mode = response.headers.get("X-Steady-Mode");
    assertEquals(mode, "relaxed");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady-Mode request header overrides to relaxed",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    // Send invalid path param (string instead of integer) with relaxed override
    const response = await fetch(`${baseUrl}/users/not-a-number`, {
      headers: { "X-Steady-Mode": "relaxed" },
    });

    // Should return 200 because relaxed mode doesn't reject
    assertEquals(response.status, 200);

    const mode = response.headers.get("X-Steady-Mode");
    assertEquals(mode, "relaxed");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady-Mode request header overrides to strict",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "relaxed" }, async (_server, baseUrl) => {
    // Send invalid path param with strict override
    const response = await fetch(`${baseUrl}/users/not-a-number`, {
      headers: { "X-Steady-Mode": "strict" },
    });

    // Should return 400 because strict mode rejects
    assertEquals(response.status, 400);

    const mode = response.headers.get("X-Steady-Mode");
    assertEquals(mode, "strict");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: invalid X-Steady-Mode header falls back to server default",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`, {
      headers: { "X-Steady-Mode": "invalid-value" },
    });

    assertEquals(response.status, 200);
    const mode = response.headers.get("X-Steady-Mode");
    assertEquals(mode, "strict");
    await response.body?.cancel();
  });
});

// =============================================================================
// Request Validation
// =============================================================================

Deno.test({
  name: "Server: validates path parameters (strict mode)",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    // Invalid: string instead of integer
    const response = await fetch(`${baseUrl}/users/not-a-number`);
    assertEquals(response.status, 400);

    const data = await response.json();
    assertEquals(data.error, "Validation failed");
    assertExists(data.errors);
  });
});

Deno.test({
  name: "Server: validates required headers (strict mode)",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    // Missing required X-API-Key header
    const response = await fetch(`${baseUrl}/items`);
    assertEquals(response.status, 400);

    const data = await response.json();
    assertExists(data.errors);
  });
});

Deno.test(
  { name: "Server: accepts valid required headers", ...serverTestOpts },
  async () => {
    await withServer({ mode: "strict" }, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/items`, {
        headers: { "X-API-Key": "my-secret-key" },
      });
      assertEquals(response.status, 200);
      await response.body?.cancel();
    });
  },
);

Deno.test({
  name: "Server: validates request body (strict mode)",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "strict" }, async (_server, baseUrl) => {
    // Missing required 'email' field
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertExists(data.errors);
  });
});

Deno.test(
  { name: "Server: accepts valid request body", ...serverTestOpts },
  async () => {
    await withServer({ mode: "strict" }, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
        }),
      });

      assertEquals(response.status, 201);
      await response.body?.cancel();
    });
  },
);

Deno.test(
  { name: "Server: validates query parameters", ...serverTestOpts },
  async () => {
    await withServer({ mode: "strict" }, async (_server, baseUrl) => {
      // Invalid: limit exceeds maximum
      const response = await fetch(`${baseUrl}/users?limit=500`);
      assertEquals(response.status, 400);

      const data = await response.json();
      assertExists(data.errors);
    });
  },
);

Deno.test(
  { name: "Server: accepts valid query parameters", ...serverTestOpts },
  async () => {
    await withServer({ mode: "strict" }, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users?limit=50&offset=10`);
      assertEquals(response.status, 200);
      await response.body?.cancel();
    });
  },
);

// =============================================================================
// Relaxed Mode
// =============================================================================

Deno.test({
  name: "Server: relaxed mode returns response despite validation errors",
  ...serverTestOpts,
}, async () => {
  await withServer({ mode: "relaxed" }, async (_server, baseUrl) => {
    // Invalid path param, but relaxed mode should still return response
    const response = await fetch(`${baseUrl}/users/not-a-number`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data); // Should still get the example response
  });
});

// =============================================================================
// Special Endpoints
// =============================================================================

Deno.test(
  { name: "Server: health endpoint returns stats", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/_x-steady/health`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(data.status, "healthy");
      assertExists(data.spec);
    });
  },
);

Deno.test({
  name: "Server: spec endpoint returns OpenAPI spec",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/_x-steady/spec`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.openapi, "3.1.0");
    assertEquals(data.info.title, "Test API");
  });
});

// =============================================================================
// Content-Type Handling
// =============================================================================

Deno.test(
  { name: "Server: returns JSON content-type", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users`);
      const contentType = response.headers.get("Content-Type");
      assertEquals(contentType, "application/json");
      await response.body?.cancel();
    });
  },
);

Deno.test(
  { name: "Server: validates Content-Type on POST", ...serverTestOpts },
  async () => {
    await withServer({ mode: "strict" }, async (_server, baseUrl) => {
      // Wrong content-type for JSON body
      const response = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
      });

      assertEquals(response.status, 400);
      await response.body?.cancel();
    });
  },
);

// =============================================================================
// Array Size Control Tests
// =============================================================================

const ARRAY_TEST_SPEC_PATH = "./tests/specs/array-test-api.yaml";

/** Helper for array size tests */
async function withArrayServer(
  opts: {
    generator?: { arrayMin?: number; arrayMax?: number; seed?: number };
    port?: number;
  },
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const spec = await parseSpecFromFile(ARRAY_TEST_SPEC_PATH);
  const port = opts.port ?? 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    mode: "strict",
    verbose: false,
    logLevel: "summary",
    interactive: false,
    generator: opts.generator,
  });

  server.start();
  await new Promise((r) => setTimeout(r, 10));
  try {
    await fn(server, `http://localhost:${port}`);
  } finally {
    server.stop();
    await new Promise((r) => setTimeout(r, 10));
  }
}

Deno.test(
  { name: "Server: default array size is 1", ...serverTestOpts },
  async () => {
    await withArrayServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/items`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(Array.isArray(data), true);
      assertEquals(data.length, 1, "Default array size should be 1");
    });
  },
);

Deno.test(
  { name: "Server: generator config sets array size", ...serverTestOpts },
  async () => {
    await withArrayServer(
      { generator: { arrayMin: 5, arrayMax: 5 } },
      async (_server, baseUrl) => {
        const response = await fetch(`${baseUrl}/items`);
        assertEquals(response.status, 200);

        const data = await response.json();
        assertEquals(Array.isArray(data), true);
        assertEquals(data.length, 5, "Array size should be 5 from config");
      },
    );
  },
);

Deno.test(
  {
    name: "Server: X-Steady-Array-Size header overrides config",
    ...serverTestOpts,
  },
  async () => {
    await withArrayServer(
      { generator: { arrayMin: 5, arrayMax: 5 } },
      async (_server, baseUrl) => {
        const response = await fetch(`${baseUrl}/items`, {
          headers: { "X-Steady-Array-Size": "10" },
        });
        assertEquals(response.status, 200);

        const data = await response.json();
        assertEquals(Array.isArray(data), true);
        assertEquals(
          data.length,
          10,
          "Array size should be 10 from header override",
        );
      },
    );
  },
);

Deno.test(
  {
    name: "Server: X-Steady-Array-Size=0 returns empty array",
    ...serverTestOpts,
  },
  async () => {
    await withArrayServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/items`, {
        headers: { "X-Steady-Array-Size": "0" },
      });
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(Array.isArray(data), true);
      assertEquals(data.length, 0, "Array size 0 should return empty array");
    });
  },
);

Deno.test(
  { name: "Server: nested arrays also respect array size", ...serverTestOpts },
  async () => {
    await withArrayServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/nested`, {
        headers: { "X-Steady-Array-Size": "3" },
      });
      assertEquals(response.status, 200);

      const data = await response.json();
      // users is required so should always be present
      assertEquals(Array.isArray(data.users), true, "users should be an array");
      assertEquals(data.users.length, 3, "users array should have 3 items");
      // Each user has required tags
      assertEquals(
        data.users[0].tags.length,
        3,
        "nested tags array should have 3 items",
      );
    });
  },
);

Deno.test(
  {
    name: "Server: X-Steady-Seed provides deterministic results",
    ...serverTestOpts,
  },
  async () => {
    await withArrayServer({}, async (_server, baseUrl) => {
      // Make two requests with the same seed
      const response1 = await fetch(`${baseUrl}/items`, {
        headers: { "X-Steady-Array-Size": "3", "X-Steady-Seed": "42" },
      });
      const data1 = await response1.json();

      const response2 = await fetch(`${baseUrl}/items`, {
        headers: { "X-Steady-Array-Size": "3", "X-Steady-Seed": "42" },
      });
      const data2 = await response2.json();

      // Same seed should produce same results
      assertEquals(
        JSON.stringify(data1),
        JSON.stringify(data2),
        "Same seed should produce identical results",
      );
    });
  },
);

Deno.test(
  {
    name: "Server: X-Steady-Seed=-1 enables random results",
    ...serverTestOpts,
  },
  async () => {
    await withArrayServer({}, async (_server, baseUrl) => {
      // Make multiple requests with seed=-1 (random)
      // With enough items, probability of identical results is negligible
      const responses = await Promise.all([
        fetch(`${baseUrl}/items`, {
          headers: { "X-Steady-Array-Size": "5", "X-Steady-Seed": "-1" },
        }),
        fetch(`${baseUrl}/items`, {
          headers: { "X-Steady-Array-Size": "5", "X-Steady-Seed": "-1" },
        }),
        fetch(`${baseUrl}/items`, {
          headers: { "X-Steady-Array-Size": "5", "X-Steady-Seed": "-1" },
        }),
      ]);

      const results = await Promise.all(responses.map((r) => r.json()));
      const jsonStrings = results.map((r) => JSON.stringify(r));

      // At least one should be different (extremely unlikely all 3 are identical with random seeds)
      const allIdentical = jsonStrings.every((s) => s === jsonStrings[0]);
      assertEquals(
        allIdentical,
        false,
        "seed=-1 should produce varied results across requests",
      );
    });
  },
);
