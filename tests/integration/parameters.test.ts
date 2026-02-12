/**
 * End-to-end parameter handling tests.
 *
 * Each test goes through the full pipeline:
 *   spec file → parseSpecFromFile → MockServer → HTTP request → assert response
 *
 * Covers: integer body, mixed path params, pagination, array body, nullable,
 * oneOf discriminator, deepObject, header arrays, cookies, enum arrays.
 */

import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server.ts";

// ── Helpers ─────────────────────────────────────────────────────────

const SPEC_PATH = "./tests/specs/parameter-suite.yaml";
let nextPort = 5200;

interface ServerContext {
  server: MockServer;
  port: number;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

async function withServer(
  fn: (ctx: ServerContext) => Promise<void>,
  opts?: { validator?: { queryObjectFormat?: "brackets" | "dots" } },
): Promise<void> {
  const port = nextPort++;
  const { spec } = await parseSpecFromFile(SPEC_PATH);
  const server = new MockServer(spec, {
    port,
    host: "localhost",
    verbose: false,
    logLevel: "summary",
    interactive: false,
    ...opts,
  });

  server.start();

  try {
    await fn({
      server,
      port,
      fetch: (path, init) => fetch(`http://localhost:${port}${path}`, init),
    });
  } finally {
    server.stop();
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

// ── /count - integer body ───────────────────────────────────────────

Deno.test({
  name: "PUT /count - integer body accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/count", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "42",
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "PUT /count - string instead of integer → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/count", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: '"not a number"',
      });
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── /json-v{version}/users/{userId} - mixed params ─────────────────

Deno.test({
  name: "POST /json-v{version}/users/{userId} - valid request",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const url = new URL(`http://localhost:${ctx.port}/json-v5/users/abc`);
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
    }, { validator: { queryObjectFormat: "brackets" } });
  },
});

Deno.test({
  name: "POST /json-v{version}/users/{userId} - invalid path param type",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch(
        "/json-vXYZ/users/abc?date=2025-01-02&time=15:04:00&datetime=2026-01-02T15:04:05Z",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "POST /json-v{version}/users/{userId} - missing required query params",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/json-v5/users/abc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assertEquals(response.status !== 404, true);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "POST /json-v{version}/users/{userId} - boolean as string in body",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch(
        "/json-v5/users/abc?date=2025-01-02&time=15:04:00&datetime=2026-01-02T15:04:05Z",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blorp: "zux",
            preferences: { theme: "gray", alerts: "no" },
          }),
        },
      );
      assertEquals(response.status !== 404, true);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── /paginated ──────────────────────────────────────────────────────

Deno.test({
  name: "GET /paginated - defaults work",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/paginated");
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /paginated - custom page and size",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/paginated?page=2&size=25");
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /paginated - size exceeds max → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/paginated?size=999");
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /paginated - array tags param",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/paginated?tags=foo&tags=bar&tags=baz");
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

// ── /ping - empty body ──────────────────────────────────────────────

Deno.test({
  name: "POST /ping - no body required",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/ping", { method: "POST" });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

// ── /bulk - array body ──────────────────────────────────────────────

Deno.test({
  name: "POST /bulk - valid array body",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ foo: "item1", baz: 1 }, {
          foo: "item2",
          baz: 2,
        }]),
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "POST /bulk - empty array → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      });
      assertEquals(response.status !== 404, true);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "POST /bulk - invalid item schema → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ foo: "item1" }]),
      });
      assertEquals(response.status !== 404, true);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── /nullable ───────────────────────────────────────────────────────

Deno.test({
  name: "POST /nullable - null for nullable field accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/nullable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredField: "test", optionalNullable: null }),
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "POST /nullable - missing required field → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/nullable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionalNullable: "test" }),
      });
      assertEquals(response.status !== 404, true);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── /events - oneOf with discriminator ──────────────────────────────

Deno.test({
  name: "POST /events - click event accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/events", {
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
    });
  },
});

Deno.test({
  name: "POST /events - view event accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "view", page: "/home", duration: 5000 }),
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

// ── /items/{item-id}/sub-items/{sub_item_id} - special chars ────────

Deno.test({
  name:
    "GET /items/{item-id}/sub-items/{sub_item_id} - hyphens and underscores",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/items/abc-123/sub-items/456");
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

// ── /search - enum array query params ───────────────────────────────

Deno.test({
  name: "GET /search - valid enum array query param",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch(
        "/search?q=test&status=draft&status=published&sort=asc",
      );
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /search - invalid enum value → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/search?q=test&status=invalid");
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── /session - cookie parameters ────────────────────────────────────

Deno.test({
  name: "GET /session - valid cookie accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/session", {
        headers: {
          Cookie: "session_id=0123456789abcdef0123456789abcdef; user_pref=dark",
        },
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /session - missing required cookie → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/session");
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

Deno.test({
  name: "GET /session - invalid cookie pattern → mock with diagnostics",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(async (ctx) => {
      const response = await ctx.fetch("/session", {
        headers: { Cookie: "session_id=0123456789ABCDEF0123456789ABCDEF" },
      });
      assertEquals(response.status, 200);
      await assertSnapshot(t, diagnosticHeaders(response));
      await response.text();
    });
  },
});

// ── Nested deepObject style ─────────────────────────────────────────

Deno.test({
  name: "nested deepObject filter[meta][level] with brackets format",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const url = new URL(`http://localhost:${ctx.port}/json-v5/users/abc`);
      url.searchParams.set("date", "2025-01-02");
      url.searchParams.set("time", "15:04:00");
      url.searchParams.set("datetime", "2026-01-02T15:04:05Z");
      url.searchParams.set("limit", "123");
      url.searchParams.append("tags", "x");
      url.searchParams.append("tags", "y");
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
      assertEquals(response.status, 200);
      await response.text();
    }, { validator: { queryObjectFormat: "brackets" } });
  },
});

// ── Header array with simple style ──────────────────────────────────

Deno.test({
  name: "header array with simple style (comma-separated)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(async (ctx) => {
      const url = new URL(`http://localhost:${ctx.port}/json-v5/users/abc`);
      url.searchParams.set("date", "2025-01-02");
      url.searchParams.set("time", "15:04:00");
      url.searchParams.set("datetime", "2026-01-02T15:04:05Z");

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": "TRACE123",
          "X-Flags": "F1, F2",
        },
        body: JSON.stringify({}),
      });
      assertEquals(response.status, 200);
      await response.text();
    });
  },
});
