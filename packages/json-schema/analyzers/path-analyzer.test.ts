/**
 * Tests for PathAnalyzer
 */

import { assertEquals } from "@std/assert";
import { assertInlineSnapshot } from "@std/testing/unstable-snapshot";
import { PathAnalyzer } from "./path-analyzer.ts";
import { SchemaRegistry } from "../schema-registry.ts";

Deno.test("PathAnalyzer: detects duplicate path patterns", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/v1/admin/secrets/{secret_id}": {
        delete: {
          responses: { "204": { description: "Deleted" } },
        },
      },
      "/v1/admin/secrets/{secret_key}": {
        post: {
          responses: { "200": { description: "Created" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
  assertEquals(diagnostics[0]!.severity, "warning");
  assertEquals(
    diagnostics[0]!.message.includes("has the same pattern as"),
    true,
  );
  assertEquals(diagnostics[0]!.related?.length, 1);
});

Deno.test("PathAnalyzer: no warning for distinct patterns", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users/{user_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/posts/{post_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});

Deno.test("PathAnalyzer: no warning for exact paths (no parameters)", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/posts": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});

Deno.test("PathAnalyzer: detects multiple duplicates in same group", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/items/{item_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/items/{item_key}": {
        post: { responses: { "200": { description: "OK" } } },
      },
      "/items/{item_name}": {
        delete: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.related?.length, 2);
});

Deno.test("PathAnalyzer: handles nested parameters", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/orgs/{org_id}/repos/{repo_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/orgs/{organization}/repos/{repository}": {
        post: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
});

Deno.test("PathAnalyzer: skips non-OpenAPI specs", () => {
  const notASpec = {
    something: "else",
  };

  const registry = new SchemaRegistry(notASpec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});

Deno.test("PathAnalyzer: detects duplicates with query params in path", () => {
  // Steady supports paths like "/files?beta=true" for query-based routing
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users/{user_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/users/{id}?beta=true": {
        get: { responses: { "200": { description: "Beta OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  // Both paths have the same base pattern "/users/{*}"
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
});

Deno.test("PathAnalyzer: warns for same base path with query variants", () => {
  // Steady supports paths like "/files?version=latest" for query-based routing.
  // These still have the same base structure and should trigger a warning
  // since they would conflict in standard OpenAPI.
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/files/{file_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/files/{file_id}?version=latest": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  // Both paths normalize to "/files/{*}" - they're structurally identical
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
});

// =============================================================================
// Multiple question marks in paths
// =============================================================================

Deno.test("PathAnalyzer: warns for path with multiple question marks", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/v1/models?beta=true?limit=10": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const multiQ = diagnostics.filter(
    (d) => d.code === "path-multiple-question-marks",
  );
  assertInlineSnapshot(
    multiQ.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      suggestion: d.suggestion,
    })),
    `[
  {
    code: "path-multiple-question-marks",
    message: \`Path "/v1/models?beta=true?limit=10" contains multiple '?' characters\`,
    severity: "warning",
    suggestion: "Only the first '?' delimits the query string. Subsequent '?' become part of parameter values, which likely indicates a URL construction bug (e.g., SDK appending '?params' to a path that already has '?query').",
  },
]`,
  );
});

Deno.test("PathAnalyzer: no warning for path with single question mark", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/v1/models?beta=true": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const multiQ = diagnostics.filter(
    (d) => d.code === "path-multiple-question-marks",
  );
  assertEquals(multiQ.length, 0);
});

Deno.test("PathAnalyzer: warns for triple question mark path", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/v1/files?beta=true?limit=10?after=abc": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const multiQ = diagnostics.filter(
    (d) => d.code === "path-multiple-question-marks",
  );
  assertInlineSnapshot(
    multiQ.map((d) => ({ code: d.code, message: d.message })),
    `[
  {
    code: "path-multiple-question-marks",
    message: \`Path "/v1/files?beta=true?limit=10?after=abc" contains multiple '?' characters\`,
  },
]`,
  );
});

// =============================================================================
// Question marks in query parameter names/values
// =============================================================================

Deno.test("PathAnalyzer: warns for query param name containing '?'", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/search": {
        get: {
          parameters: [
            {
              name: "active?",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const qmark = diagnostics.filter(
    (d) => d.code === "param-question-mark-in-query",
  );
  assertInlineSnapshot(
    qmark.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      suggestion: d.suggestion,
    })),
    `[
  {
    code: "param-question-mark-in-query",
    message: \`Query parameter "active?" contains '?' in its name\`,
    severity: "warning",
    suggestion: \`'?' in query parameter names causes ambiguity with the URL query delimiter. Consider renaming to "active" or using percent-encoding.\`,
  },
]`,
  );
});

Deno.test("PathAnalyzer: warns for enum values containing '?'", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/search": {
        get: {
          parameters: [
            {
              name: "confidence",
              in: "query",
              schema: {
                type: "string",
                enum: ["yes", "no", "maybe?", "unknown?"],
              },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const qmark = diagnostics.filter(
    (d) => d.code === "param-question-mark-in-query",
  );
  assertInlineSnapshot(
    qmark.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      suggestion: d.suggestion,
    })),
    `[
  {
    code: "param-question-mark-in-query",
    message: \`Query parameter "confidence" has enum values containing '?': "maybe?", "unknown?"\`,
    severity: "warning",
    suggestion: "'?' in query parameter values is ambiguous with the URL query delimiter and may be inconsistently percent-encoded.",
  },
]`,
  );
});

Deno.test("PathAnalyzer: no warning for normal query params", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/search": {
        get: {
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const qmark = diagnostics.filter(
    (d) => d.code === "param-question-mark-in-query",
  );
  assertEquals(qmark.length, 0);
});

Deno.test("PathAnalyzer: ignores '?' in path params (only checks query params)", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/items/{item_id}": {
        get: {
          parameters: [
            {
              name: "item?",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const qmark = diagnostics.filter(
    (d) => d.code === "param-question-mark-in-query",
  );
  assertEquals(qmark.length, 0);
});

Deno.test("PathAnalyzer: warns for bracket notation with '?' in query param name", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/search": {
        get: {
          parameters: [
            {
              name: "filter[is_valid?]",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  const qmark = diagnostics.filter(
    (d) => d.code === "param-question-mark-in-query",
  );
  assertInlineSnapshot(
    qmark.map((d) => ({ code: d.code, message: d.message })),
    `[
  {
    code: "param-question-mark-in-query",
    message: \`Query parameter "filter[is_valid?]" contains '?' in its name\`,
  },
]`,
  );
});
