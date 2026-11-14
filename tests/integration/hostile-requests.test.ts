/**
 * Requests and schemas built to exhaust request validation. The server must
 * answer every one of them itself: a 5xx tells the SDK under test that the
 * mock failed.
 */

import { assertEquals } from "@std/assert";
import { parseSpec } from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

async function withServer(
  schema: unknown,
  schemas: Record<string, unknown>,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const document = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "hostile", version: "1" },
    paths: {
      "/x": {
        post: {
          requestBody: { content: { "application/json": { schema } } },
          responses: { "200": { description: "ok" } },
        },
      },
    },
    components: { schemas },
  });
  const { spec, defaultedFields } = await parseSpec(document, {
    format: "json",
  });
  const analysis = analyzeSpec(spec, {
    baseUri: "file:///hostile.json",
    defaultedFields,
  });
  const server = new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    logLevel: "summary",
    startupDiagnostics: analysis.diagnostics,
    specPath: "hostile.json",
  }, analysis.docIndex);
  const port = await server.start();
  try {
    await run(`http://127.0.0.1:${port}/x`);
  } finally {
    await server.stop();
  }
}

async function post(url: string, body: string): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  await response.body?.cancel();
  return response;
}

Deno.test("a schema that only refers to itself does not break requests", async () => {
  await withServer(
    { $ref: "#/components/schemas/Self" },
    { Self: { $ref: "#/components/schemas/Self" } },
    async (url) => {
      assertEquals((await post(url, '{"a":1}')).status, 200);
    },
  );
});

Deno.test("schemas that refer to each other without consuming input do not break requests", async () => {
  await withServer(
    { $ref: "#/components/schemas/A" },
    {
      A: { allOf: [{ $ref: "#/components/schemas/B" }] },
      B: { anyOf: [{ $ref: "#/components/schemas/A" }] },
    },
    async (url) => {
      assertEquals((await post(url, '"x"')).status, 200);
    },
  );
});

Deno.test("a request body nested 5 000 levels is answered, with a note about the depth", async () => {
  await withServer(
    { $ref: "#/components/schemas/Tree" },
    {
      Tree: {
        type: "object",
        properties: { k: { $ref: "#/components/schemas/Tree" } },
      },
    },
    async (url) => {
      const body = '{"k":'.repeat(5000) + "{}" + "}".repeat(5000);
      const response = await post(url, body);
      assertEquals(response.status, 200);
      // Not validating the deep part is reported, and does not make the
      // request an SDK error.
      assertEquals(response.headers.get("x-steady-request-valid"), "true");
      assertEquals(response.headers.get("x-steady-error-count"), "1");
      assertEquals(
        response.headers.get("x-steady-error-1-message")?.includes(
          "nested deeper than 500 levels",
        ),
        true,
      );
    },
  );
});
