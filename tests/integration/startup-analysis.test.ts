/**
 * End-to-end tests for startup spec analysis.
 *
 * Each test goes through the full pipeline:
 *   raw JSON string → parseSpec → analyzeSpec → assert on diagnostics
 *
 * No mocks, no shortcuts. These exercise the real parser and analyzer.
 */

import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { parseSpec } from "@steady/openapi";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";

Deno.test("missing responses → E1010", async (t) => {
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: { summary: "No responses defined" },
      },
    },
  }));

  const result = await analyzeSpec(spec);
  await assertSnapshot(t, result.diagnostics);
});

Deno.test("duplicate path parameter names → E1009", async (t) => {
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users/{id}/posts/{id}": {
        get: {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  }));

  const result = await analyzeSpec(spec);
  await assertSnapshot(t, result.diagnostics);
});

Deno.test("unresolved $ref → E1004 + fatal", async (t) => {
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Ghost" },
                },
              },
            },
          },
        },
      },
    },
  }));

  const result = await analyzeSpec(spec);
  assertEquals(result.fatal, true);
  await assertSnapshot(t, result.diagnostics);
});

Deno.test("clean spec → no diagnostics", async () => {
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  }));

  const result = await analyzeSpec(spec);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.fatal, false);
});
