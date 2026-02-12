/**
 * Tests for MockServer
 *
 * Covers:
 * - Route matching (exact and parameterized paths)
 * - Response generation from examples
 * - X-Steady diagnostic headers
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
  opts: { rejectOnSdkError?: boolean; port?: number },
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(TEST_SPEC_PATH);
  const port = opts.port ?? 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    rejectOnSdkError: opts.rejectOnSdkError,
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
// X-Steady Diagnostic Headers
// =============================================================================

Deno.test({
  name: "Server: X-Steady-Valid is true for valid request",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("X-Steady-Valid"), "true");
    assertEquals(response.headers.get("X-Steady-Error-Count"), "0");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady-Valid is false when body has missing required field",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    // Mock response returned. Validation issues reported in headers only.
    assertEquals(response.status, 201);
    assertEquals(response.headers.get("X-Steady-Valid"), "false");

    const errorCount = parseInt(
      response.headers.get("X-Steady-Error-Count") ?? "0",
    );
    assertEquals(errorCount > 0, true);

    assertExists(response.headers.get("X-Steady-Error-1-Code"));
    assertExists(response.headers.get("X-Steady-Error-1-Path"));
    assertExists(response.headers.get("X-Steady-Error-1-Message"));
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady headers present on 404",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/nonexistent`);
    assertEquals(response.status, 404);
    assertExists(response.headers.get("X-Steady-Valid"));
    assertExists(response.headers.get("X-Steady-Error-Count"));
    await response.body?.cancel();
  });
});

// =============================================================================
// Sessions
// =============================================================================

Deno.test({
  name: "Server: session accumulates diagnostics across requests",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const sessionId = crypto.randomUUID();

    // Request 1: valid
    await fetch(`${baseUrl}/users`, {
      headers: { "X-Steady-Session": sessionId },
    }).then((r) => r.body?.cancel());

    // Request 2: missing required field
    await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Steady-Session": sessionId,
      },
      body: JSON.stringify({ name: "Alice" }),
    }).then((r) => r.body?.cancel());

    // Query session
    const report = await fetch(
      `${baseUrl}/_x-steady/sessions/${sessionId}`,
    ).then((r) => r.json());

    assertEquals(report.session_id, sessionId);
    assertEquals(report.requests, 2);
    assertEquals(report.sdk_issues.length > 0, true);
    assertEquals(report.sdk_issues[0].method, "POST");
  });
});

Deno.test({
  name: "Server: session returns 404 for unknown session",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(
      `${baseUrl}/_x-steady/sessions/nonexistent`,
    );
    assertEquals(response.status, 404);
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: session tracks 404 diagnostics",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const sessionId = crypto.randomUUID();

    // Request to nonexistent path
    await fetch(`${baseUrl}/does-not-exist`, {
      headers: { "X-Steady-Session": sessionId },
    }).then((r) => r.body?.cancel());

    const report = await fetch(
      `${baseUrl}/_x-steady/sessions/${sessionId}`,
    ).then((r) => r.json());

    assertEquals(report.requests, 1);
    assertEquals(report.sdk_issues.length > 0, true);
    assertEquals(report.sdk_issues[0].code, "E2001");
  });
});

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

Deno.test({
  name:
    "Server: returns empty JSON object when Accept: application/json but no content defined",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/void-response`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ data: "test" }),
    });
    assertEquals(response.status, 200);

    // When client accepts JSON but spec has no content, return empty object
    const contentType = response.headers.get("Content-Type");
    assertEquals(contentType, "application/json");

    const body = await response.json();
    assertEquals(body, {});
  });
});

Deno.test({
  name:
    "Server: no Content-Type when client doesn't accept JSON and no content defined",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/void-response`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/plain", // Explicitly doesn't accept JSON
      },
      body: JSON.stringify({ data: "test" }),
    });
    assertEquals(response.status, 200);

    // When client doesn't accept JSON and no content defined, no Content-Type
    const contentType = response.headers.get("Content-Type");
    assertEquals(contentType, null);

    const body = await response.text();
    assertEquals(body, "");
  });
});

Deno.test({
  name: "Server: readOnly properties should not be required in request body",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    // Send request with only 'name' - 'id' is readOnly so shouldn't be required
    const response = await fetch(`${baseUrl}/read-only-props`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });

    // Should succeed - readOnly 'id' property should not be required in request
    assertEquals(response.status, 200);
    await response.body?.cancel();
  });
});

// =============================================================================
// X-Steady-Reject-On-Error
// =============================================================================

Deno.test({
  name: "Server: default returns mock response for validation failures",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    // Missing required 'email' field, but default is to always mock
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    assertEquals(response.status, 201);
    assertEquals(response.headers.get("X-Steady-Valid"), "false");
    await response.body?.cancel();
  });
});

Deno.test({
  name:
    "Server: reject-on-sdk-error returns 400 for missing required body field",
  ...serverTestOpts,
}, async () => {
  await withServer(
    { rejectOnSdkError: true },
    async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      });
      assertEquals(response.status, 400);

      const data = await response.json();
      assertEquals(data.error, "Validation failed");
      assertExists(data.diagnostics);
    },
  );
});

Deno.test({
  name: "Server: X-Steady-Reject-On-Error header overrides default to reject",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Steady-Reject-On-Error": "true",
      },
      body: JSON.stringify({ name: "Alice" }),
    });
    assertEquals(response.status, 400);
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: X-Steady-Reject-On-Error: false overrides server setting",
  ...serverTestOpts,
}, async () => {
  await withServer(
    { rejectOnSdkError: true },
    async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Steady-Reject-On-Error": "false",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
      // Header disables rejection, so mock response returned
      assertEquals(response.status, 201);
      assertEquals(response.headers.get("X-Steady-Valid"), "false");
      await response.body?.cancel();
    },
  );
});

// =============================================================================
// Request Validation
// =============================================================================

Deno.test({
  name: "Server: invalid path param returns mock response by default",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/users/not-a-number`);
    assertEquals(response.status, 200);
    await response.body?.cancel();
  });
});

Deno.test({
  name:
    "Server: missing required header returns mock with X-Steady-Valid: false",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    // Missing required X-API-Key header. Engine produces E3004 (sdk-issue).
    const response = await fetch(`${baseUrl}/items`);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("X-Steady-Valid"), "false");
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: reject-on-sdk-error returns 400 for missing required header",
  ...serverTestOpts,
}, async () => {
  await withServer(
    { rejectOnSdkError: true },
    async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/items`);
      assertEquals(response.status, 400);
      await response.body?.cancel();
    },
  );
});

Deno.test(
  { name: "Server: accepts valid required headers", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/items`, {
        headers: { "X-API-Key": "my-secret-key" },
      });
      assertEquals(response.status, 200);
      await response.body?.cancel();
    });
  },
);

Deno.test(
  { name: "Server: accepts valid request body", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
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
  {
    name: "Server: invalid query param returns mock response by default",
    ...serverTestOpts,
  },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users?limit=500`);
      assertEquals(response.status, 200);
      await response.body?.cancel();
    });
  },
);

Deno.test(
  { name: "Server: accepts valid query parameters", ...serverTestOpts },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      const response = await fetch(`${baseUrl}/users?limit=50&offset=10`);
      assertEquals(response.status, 200);
      await response.body?.cancel();
    });
  },
);

// =============================================================================
// Default Behavior (always mock when routing succeeds)
// =============================================================================

Deno.test({
  name: "Server: returns mock response despite validation errors by default",
  ...serverTestOpts,
}, async () => {
  await withServer({}, async (_server, baseUrl) => {
    // Invalid path param. Default always returns mock + diagnostic headers.
    const response = await fetch(`${baseUrl}/users/not-a-number`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data);
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
  {
    name: "Server: wrong Content-Type returns mock with diagnostic headers",
    ...serverTestOpts,
  },
  async () => {
    await withServer({}, async (_server, baseUrl) => {
      // Wrong content-type. Default always mocks.
      const response = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
      });

      // Default behavior: mock response + diagnostic headers
      assertEquals(response.status, 201);
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
  const { spec } = await parseSpecFromFile(ARRAY_TEST_SPEC_PATH);
  const port = opts.port ?? 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
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

// =============================================================================
// Query Strings in Paths
// =============================================================================

const QUERY_PATH_SPEC = "./tests/specs/query-in-path.yaml";

async function withQueryPathServer(
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(QUERY_PATH_SPEC);
  const port = 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    verbose: false,
    logLevel: "summary",
    interactive: false,
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

Deno.test({
  name: "Server: matches path with query string when query param present",
  ...serverTestOpts,
}, async () => {
  await withQueryPathServer(async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/files?beta=true`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.type, "beta");
  });
});

Deno.test({
  name: "Server: matches path without query string when query param absent",
  ...serverTestOpts,
}, async () => {
  await withQueryPathServer(async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/files`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.type, "standard");
  });
});

Deno.test({
  name: "Server: matches parameterized path with query string",
  ...serverTestOpts,
}, async () => {
  await withQueryPathServer(async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/models/abc?beta=true`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.type, "beta");
  });
});

Deno.test({
  name: "Server: matches parameterized path without query string",
  ...serverTestOpts,
}, async () => {
  await withQueryPathServer(async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/models/abc`);
    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.type, "standard");
  });
});

// =============================================================================
// Same Pattern Different Methods Tests
// =============================================================================

const SAME_PATTERN_SPEC_PATH =
  "./test-fixtures/cursed-specs/duplicate-path-patterns.yaml";

/** Helper for same-pattern-different-methods tests */
async function withSamePatternServer(
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(SAME_PATTERN_SPEC_PATH);
  const port = 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    verbose: false,
    logLevel: "summary",
    interactive: false,
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

Deno.test({
  name: "Server: matches DELETE on first of two same-pattern paths",
  ...serverTestOpts,
}, async () => {
  await withSamePatternServer(async (_server, baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/admin/secrets/my-secret`, {
      method: "DELETE",
    });
    assertEquals(response.status, 204);
    await response.body?.cancel();
  });
});

Deno.test({
  name: "Server: matches POST on second of two same-pattern paths",
  ...serverTestOpts,
}, async () => {
  await withSamePatternServer(async (_server, baseUrl) => {
    // This tests the bug: POST should match the second path definition
    // even though it has the same URL pattern as the first (DELETE) path
    const response = await fetch(`${baseUrl}/v1/admin/secrets/my-secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "secret-value" }),
    });
    assertEquals(
      response.status,
      200,
      "POST should match the second path definition, not fail with 404",
    );
    const data = await response.json();
    assertExists(data.key);
  });
});

// =============================================================================
// Cursed Spec: Question Marks in Query Parameter Names/Values
// =============================================================================

const CURSED_QMARK_SPEC =
  "./test-fixtures/cursed-specs/question-mark-query-params.yaml";

async function withCursedQmarkServer(
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(CURSED_QMARK_SPEC);
  const port = 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    verbose: false,
    logLevel: "summary",
    interactive: false,
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

Deno.test({
  name: "Server: cursed spec - query param name with trailing question mark",
  ...serverTestOpts,
}, async () => {
  await withCursedQmarkServer(async (_server, baseUrl) => {
    // Param name is "active?", must be percent-encoded as active%3F in the URL
    const response = await fetch(
      `${baseUrl}/search?q=hello&active%3F=true`,
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertExists(data.results);
  });
});

Deno.test({
  name: "Server: cursed spec - query param enum value with question mark",
  ...serverTestOpts,
}, async () => {
  await withCursedQmarkServer(async (_server, baseUrl) => {
    // Enum value "maybe?": the ? is part of the value, percent-encoded
    const response = await fetch(
      `${baseUrl}/search?q=hello&confidence=maybe%3F`,
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertExists(data.results);
  });
});

Deno.test({
  name:
    "Server: cursed spec - query param with bracket notation and question mark",
  ...serverTestOpts,
}, async () => {
  await withCursedQmarkServer(async (_server, baseUrl) => {
    // Param name "filter[is_valid?]": both brackets and ? need encoding
    const response = await fetch(
      `${baseUrl}/search?q=hello&filter%5Bis_valid%3F%5D=true`,
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertExists(data.results);
  });
});

Deno.test({
  name: "Server: cursed spec - question mark param name sent unencoded",
  ...serverTestOpts,
}, async () => {
  await withCursedQmarkServer(async (_server, baseUrl) => {
    // What if the client sends "active?" unencoded?
    // URL becomes: /search?q=hello&active?=true
    // Server parses: q=hello, active?=true (the ? is just a char in query string)
    const response = await fetch(
      `${baseUrl}/search?q=hello&active?=true`,
    );
    // Whether this matches depends on how the server parses unencoded ? in query keys
    // The key point: it should not crash
    await response.json();
  });
});

Deno.test({
  name: "Server: cursed spec - enum value with unencoded question mark",
  ...serverTestOpts,
}, async () => {
  await withCursedQmarkServer(async (_server, baseUrl) => {
    // "maybe?" sent unencoded. The ? is inside the query value.
    // /search?q=hello&confidence=maybe?
    // Server parses: q=hello, confidence=maybe? (trailing ? is part of value)
    const response = await fetch(
      `${baseUrl}/search?q=hello&confidence=maybe?`,
    );
    await response.json();
  });
});

// =============================================================================
// Cursed Client: Double Question Mark in URL (anthropic-sdk-go bug)
// =============================================================================
// Uses the existing query-in-path spec since it already has ?beta=true paths.

const CURSED_CLIENT_SPEC = "./tests/specs/query-in-path.yaml";

async function withCursedClientServer(
  fn: (server: MockServer, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(CURSED_CLIENT_SPEC);
  const port = 3100 + Math.floor(Math.random() * 900);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    verbose: false,
    logLevel: "summary",
    interactive: false,
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

Deno.test({
  name:
    "Server: cursed client - double question mark does not match beta route",
  ...serverTestOpts,
}, async () => {
  await withCursedClientServer(async (_server, baseUrl) => {
    // Go SDK bug: ?beta=true?extra=1, second ? instead of &
    // Server sees beta="true?extra=1", not beta="true"
    // Should NOT match the ?beta=true route
    const response = await fetch(`${baseUrl}/files?beta=true?extra=1`);
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(
      data.type,
      "standard",
      "Double-? URL must NOT match beta route (beta value is 'true?extra=1', not 'true')",
    );
  });
});

Deno.test({
  name: "Server: cursed client - correct URL matches beta route (control test)",
  ...serverTestOpts,
}, async () => {
  await withCursedClientServer(async (_server, baseUrl) => {
    // Correct URL with &. Should match beta route.
    const response = await fetch(`${baseUrl}/files?beta=true&extra=1`);
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(
      data.type,
      "beta",
      "Correct URL with & should match beta route",
    );
  });
});

Deno.test({
  name: "Server: cursed client - double question mark on parameterized path",
  ...serverTestOpts,
}, async () => {
  await withCursedClientServer(async (_server, baseUrl) => {
    // Go SDK: /models/{id}?beta=true + "?" + "foo=bar"
    const response = await fetch(
      `${baseUrl}/models/claude-3?beta=true?foo=bar`,
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(
      data.type,
      "standard",
      "Double-? on parameterized path must NOT match beta route",
    );
  });
});

Deno.test({
  name: "Server: cursed client - triple question mark",
  ...serverTestOpts,
}, async () => {
  await withCursedClientServer(async (_server, baseUrl) => {
    const response = await fetch(
      `${baseUrl}/files?beta=true?limit=10?after=abc`,
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(
      data.type,
      "standard",
      "Triple-? URL must NOT match beta route",
    );
  });
});
