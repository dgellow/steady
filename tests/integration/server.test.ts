/**
 * End-to-end server integration tests.
 *
 * Each test goes through the full pipeline:
 *   spec file → parseSpecFromFile → MockServer → HTTP request → assert response
 *
 * Tests spec loading, path matching, body validation, path param validation,
 * query params, and performance with enterprise-scale specs.
 */

import { assertEquals, assertExists } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { request as httpRequest } from "node:http";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";
import { matchPathPattern } from "../../src/path-matcher.ts";

// ── Helpers ─────────────────────────────────────────────────────────

interface ServerContext {
  server: MockServer;
  port: number;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

async function withServer(
  specPath: string,
  fn: (ctx: ServerContext) => Promise<void>,
  opts?: { validator?: { queryObjectFormat?: "brackets" | "dots" } },
): Promise<void> {
  const { spec } = await parseSpecFromFile(specPath);
  const server = new MockServer(spec, {
    port: 0,
    host: "localhost",
    logLevel: "summary",
    ...opts,
  });

  const port = await server.start();

  try {
    await fn({
      server,
      port,
      fetch: (path, init) => fetch(`http://localhost:${port}${path}`, init),
    });
  } finally {
    await server.stop();
  }
}

/** Extract X-Steady-* diagnostic headers from a response. */
function diagnosticHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase().startsWith("x-steady-")) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

const BODY_SPEC = "./tests/specs/test-spec-with-body.yaml";
const DATADOG_SPEC = "./tests/fixtures/datadog-openapi.json";

// ── Path matching (unit-level, no server) ───────────────────────────

Deno.test("path parameter extraction", () => {
  const r1 = matchPathPattern(
    "/api/v1/dashboard/abc-123-def",
    "/api/v1/dashboard/{dashboard_id}",
  );
  assertExists(r1);
  assertEquals(r1.dashboard_id, "abc-123-def");

  const r2 = matchPathPattern(
    "/api/v1/events/event-456",
    "/api/v1/events/{event_id}",
  );
  assertExists(r2);
  assertEquals(r2.event_id, "event-456");

  const r3 = matchPathPattern(
    "/api/v1/host/my-host.example.com/mute",
    "/api/v1/host/{host_name}/mute",
  );
  assertExists(r3);
  assertEquals(r3.host_name, "my-host.example.com");
});

Deno.test("multiple path parameters + URL encoding", () => {
  const result = matchPathPattern(
    "/api/v2/users/123/posts/456",
    "/api/v2/users/{user_id}/posts/{post_id}",
  );
  assertExists(result);
  assertEquals(result.user_id, "123");
  assertEquals(result.post_id, "456");

  const encoded = matchPathPattern(
    "/api/v1/items/hello%20world",
    "/api/v1/items/{item_id}",
  );
  assertExists(encoded);
  assertEquals(encoded.item_id, "hello world");
});

Deno.test("path matching edge cases", () => {
  assertEquals(matchPathPattern("/users/123/posts", "/users/{id}"), null);
  assertEquals(matchPathPattern("/items/123", "/users/{id}"), null);

  const exact = matchPathPattern("/api/health", "/api/health");
  assertExists(exact);
  assertEquals(Object.keys(exact).length, 0);
});

// ── Spec loading ────────────────────────────────────────────────────

Deno.test("load Datadog spec (8.4MB, 323 endpoints)", async () => {
  const { spec } = await parseSpecFromFile(DATADOG_SPEC);

  assertEquals(spec.openapi, "3.0.3");
  assertEquals(spec.info.title, "Datadog API Collection");
  assertEquals(Object.keys(spec.paths).length, 323);
});

// ── HTTP server: body validation ────────────────────────────────────

Deno.test({
  name: "valid request body → 200",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          age: 30,
        }),
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "missing required field → mock response with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob" }),
      });
      assertEquals(response.status, 400);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "type mismatch in body → mock response with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Charlie",
          email: "not-an-email",
          age: "not-a-number",
        }),
      });
      assertEquals(response.status, 400);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── HTTP server: empty body on bodyless endpoints ───────────────────

Deno.test({
  name:
    "POST with Content-Type: application/json but no body to bodyless endpoint → 200",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      // SDKs commonly set Content-Type: application/json on all requests,
      // even for action endpoints (cancel, deactivate) with no request body.
      const response = await ctx.fetch("/users/123/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name:
    "DELETE with Content-Type: application/json but no body to bodyless endpoint → 200",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users/123/deactivate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "POST with empty body to required-body endpoint → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      // This endpoint requires a body. Empty body should be rejected.
      const response = await ctx.fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assertEquals(response.status, 400);
      const headers = diagnosticHeaders(response);
      assertEquals(headers["x-steady-request-valid"], "false");
      await response.text();
    });
  },
});

// ── HTTP server: path params ────────────────────────────────────────

Deno.test({
  name: "valid integer path param → 200",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users/123");
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "invalid integer path param → mock response",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      const response = await ctx.fetch("/users/not-a-number");
      assertEquals(response.status, 400);
      await response.text();
    });
  },
});

// ── HTTP server: performance ────────────────────────────────────────

Deno.test({
  name: "complex nested schema validates under 500ms",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(DATADOG_SPEC, async (ctx) => {
      const start = performance.now();
      const response = await ctx.fetch("/api/v1/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Dashboard",
          description: "Integration test dashboard",
          widgets: [],
          layout_type: "ordered",
        }),
      });
      const duration = performance.now() - start;

      assertExists(response);
      await response.text();
      assertEquals(
        duration < 500,
        true,
        `Validation took ${duration}ms, expected < 500ms`,
      );
    });
  },
});

// ── HTTP server: QUERY method ──────────────────────────────────────

const QUERY_METHOD_SPEC = "./tests/specs/test-query-method.yaml";

Deno.test({
  name: "QUERY method with body → 200 with mock response",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(QUERY_METHOD_SPEC, async (ctx) => {
      const response = await ctx.fetch("/search", {
        method: "QUERY",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "test", limit: 10 }),
      });
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(typeof body, "object");
    });
  },
});

Deno.test({
  name: "QUERY method without body → diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(QUERY_METHOD_SPEC, async (ctx) => {
      const response = await ctx.fetch("/search", {
        method: "QUERY",
      });
      // Should still get a response (mock server is lenient by default)
      assertExists(response);
      await response.text();
    });
  },
});

// ── HTTP server: redirect responses ────────────────────────────────

const REDIRECT_SPEC = "./tests/specs/test-redirect.yaml";

Deno.test({
  name: "303 response redirects to /_x-steady/redirected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
        redirect: "manual",
      });
      assertEquals(response.status, 303);
      const location = response.headers.get("Location");
      assertEquals(location, "/_x-steady/redirected");
    });
  },
});

Deno.test({
  name: "/_x-steady/redirected returns 200",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/_x-steady/redirected");
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.status, "redirected");
    });
  },
});

Deno.test({
  name: "303 response uses Location example from spec",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/cards-with-example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
        redirect: "manual",
      });
      assertEquals(response.status, 303);
      assertEquals(response.headers.get("Location"), "/cards/abc-123");
    });
  },
});

Deno.test({
  name: "303 response uses Location default from schema",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/cards-with-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
        redirect: "manual",
      });
      assertEquals(response.status, 303);
      assertEquals(
        response.headers.get("Location"),
        "/cards/default-location",
      );
    });
  },
});

Deno.test({
  name: "303 response resolves Location from header $ref",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/cards-with-header-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
        redirect: "manual",
      });
      assertEquals(response.status, 303);
      assertEquals(
        response.headers.get("Location"),
        "/cards/from-header-ref",
      );
    });
  },
});

Deno.test({
  name: "303 response resolves Location from schema $ref",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REDIRECT_SPEC, async (ctx) => {
      const response = await ctx.fetch("/cards-with-schema-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
        redirect: "manual",
      });
      assertEquals(response.status, 303);
      assertEquals(
        response.headers.get("Location"),
        "/cards/from-schema-ref",
      );
    });
  },
});

// ── Response generation: $ref examples ──────────────────────────────

const REF_EXAMPLE_SPEC = "./tests/specs/ref-example-spec.yaml";

Deno.test({
  name: "response with $ref examples does not 500",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REF_EXAMPLE_SPEC, async (ctx) => {
      const response = await ctx.fetch("/settings/cache_reserve", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "on" }),
      });

      // Should not crash. 200 is fine, anything below 500 is acceptable.
      assertEquals(response.status < 500, true, `Got ${response.status}`);
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name: "diagnostics preserved when response generation fails",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(REF_EXAMPLE_SPEC, async (ctx) => {
      // Send wrong content-type. Even if response generation fails,
      // the E3006 diagnostic should still be reported.
      const response = await ctx.fetch("/settings/cache_reserve", {
        method: "PATCH",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ value: "on" }),
      });

      const valid = response.headers.get("x-steady-request-valid");
      assertEquals(valid, "false", "Should detect wrong content-type");

      const errorCount = parseInt(
        response.headers.get("x-steady-error-count") ?? "0",
        10,
      );
      assertEquals(
        errorCount > 0,
        true,
        "Should report at least one diagnostic",
      );

      await response.body?.cancel();
    });
  },
});

// ── HTTP server: GET with request body ───────────────────────────────

/** Send a request via node:http (supports body on GET/HEAD). */
function sendViaNodeHttp(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        res.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        res.on("end", () => {
          const buf = new Uint8Array(
            chunks.reduce((acc, c) => acc + c.length, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            buf.set(chunk, offset);
            offset += chunk.length;
          }
          const h = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) {
              const v = Array.isArray(value) ? value[0] : value;
              if (v) h.set(key, v);
            }
          }
          resolve(
            new Response(buf.length > 0 ? buf : null, {
              status: res.statusCode ?? 200,
              headers: h,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

Deno.test({
  name: "GET request body is stripped by Deno.serve (cannot validate)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(BODY_SPEC, async (ctx) => {
      // Deno.serve strips the body from GET requests before our handler
      // sees it. Even though we send a wrong body type via node:http,
      // the server never receives it and reports the request as valid.
      const response = await sendViaNodeHttp(
        `http://localhost:${ctx.port}/balances/test-account`,
        "GET",
        { "content-type": "application/json" },
        JSON.stringify({ address: 99999 }), // wrong type, but stripped
      );
      const valid = response.headers.get("x-steady-request-valid");
      assertEquals(response.status, 200);
      assertEquals(valid, "true", "Body is stripped so request appears valid");
      await response.body?.cancel();
    });
  },
});

// ── HTTP server: query params ───────────────────────────────────────

Deno.test({
  name: "query parameter forwarded correctly",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(DATADOG_SPEC, async (ctx) => {
      const response = await ctx.fetch("/api/v1/hosts?filter=hostname:example");
      assertExists(response);
      await response.text();
    });
  },
});

// ── Response content type: octet-stream ─────────────────────────────

const OCTET_SPEC = "./tests/specs/octet-stream.yaml";

Deno.test({
  name: "octet-stream response is not JSON-quoted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(OCTET_SPEC, async (ctx) => {
      const response = await ctx.fetch("/download");
      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("content-type"),
        "application/octet-stream",
      );
      const text = await response.text();
      // Should NOT start with a JSON quote
      assertEquals(
        text.startsWith('"'),
        false,
        `Response body is JSON-quoted: ${text}`,
      );
    });
  },
});

Deno.test({
  name: "text/plain response is not JSON-quoted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(OCTET_SPEC, async (ctx) => {
      const response = await ctx.fetch("/text");
      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("content-type"),
        "text/plain",
      );
      const text = await response.text();
      assertEquals(text, "Hello world");
    });
  },
});

Deno.test({
  name:
    "empty response schema (application/json) returns valid JSON {}, not empty body",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Per JSON Schema semantics, `schema: {}` permits any instance.
    // The generator has no shape to infer and returns null, but the
    // HTTP response body for application/json must still be valid
    // JSON. The HTTP layer falls back to {} so SDK clients don't
    // crash inside response.json().
    await withServer(
      "./tests/specs/empty-response-schema.yaml",
      async (ctx) => {
        const response = await ctx.fetch("/any");
        assertEquals(response.status, 200);
        assertEquals(
          response.headers.get("content-type"),
          "application/json",
        );
        const text = await response.text();
        assertEquals(text.length > 0, true, "body must not be empty");
        assertEquals(JSON.parse(text), {});
      },
    );
  },
});

// ── Content negotiation (RFC 9110 section 12.5.1) ───────────────────

const NEGOTIATION_SPEC = "./tests/specs/content-negotiation.yaml";

Deno.test({
  name: "Accept weights select the response content type",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(NEGOTIATION_SPEC, async (ctx) => {
      const cases: Array<[accept: string, expected: string]> = [
        // q=0 means "not acceptable", so JSON must not be chosen.
        ["application/json;q=0, text/plain", "text/plain"],
        ["application/json;q=0.0, */*", "text/plain"],
        // Highest weight wins regardless of position in the header.
        ["text/plain;q=0.5, application/json", "application/json"],
        // Equal weights: header order.
        ["application/json, text/plain", "application/json"],
        // A member with an invalid weight is ignored.
        ["application/json;q=abc, text/plain;q=0.1", "text/plain"],
        // Subtype wildcard.
        ["application/*", "application/json"],
        // Wildcard: first content type declared by the spec.
        ["*/*", "text/plain"],
        // Nothing acceptable: the mock still answers with the first type.
        ["image/png", "text/plain"],
      ];
      for (const [accept, expected] of cases) {
        await t.step(`Accept: ${accept} -> ${expected}`, async () => {
          const response = await ctx.fetch("/multi", {
            headers: { "Accept": accept },
          });
          assertEquals(response.status, 200);
          assertEquals(response.headers.get("content-type"), expected);
          await response.body?.cancel();
        });
      }
    });
  },
});

Deno.test({
  name: "request Content-Type matches a subtype wildcard content key",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(NEGOTIATION_SPEC, async (ctx) => {
      const ok = await ctx.fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      });
      assertEquals(diagnosticHeaders(ok)["x-steady-error-count"], "0");
      assertEquals(ok.status, 204);
      await ok.body?.cancel();

      const wrong = await ctx.fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not an image",
      });
      assertEquals(diagnosticHeaders(wrong)["x-steady-error-1-code"], "E3006");
      await wrong.body?.cancel();
    });
  },
});
