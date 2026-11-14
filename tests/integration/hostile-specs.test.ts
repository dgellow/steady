/**
 * Specs built to exhaust the loader: nesting at the accepted limit and very
 * long reference chains. Each goes through the full startup pipeline
 * (parseSpec, analyzeSpec, MockServer) and, where it loads, serves a request.
 *
 * The parser tests in packages/openapi cover the documents that are
 * rejected at the boundary (self-containing YAML aliases, alias expansion,
 * nesting beyond the limit). These tests cover what is accepted: everything
 * behind the boundary has to cope with it.
 */

import { assertEquals } from "@std/assert";
import {
  MAX_DOCUMENT_DEPTH,
  parseSpec,
} from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

async function startServer(document: string): Promise<{
  port: number;
  diagnostics: number;
  stop: () => Promise<void>;
}> {
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
  return {
    port,
    diagnostics: analysis.diagnostics.length,
    stop: () => server.stop(),
  };
}

function specFor(
  schema: unknown,
  schemas: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "hostile", version: "1" },
    paths: {
      "/x": {
        post: {
          requestBody: { content: { "application/json": { schema } } },
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema } },
            },
          },
        },
      },
    },
    components: { schemas },
  };
}

Deno.test("a schema nested to the document depth limit loads, validates and generates", async () => {
  // The body schema sits 8 levels below the root; each level of nesting
  // adds 2 (the object and its `properties`).
  const levels = Math.floor((MAX_DOCUMENT_DEPTH - 8) / 2) - 1;
  let schema: unknown = { type: "string" };
  let body: unknown = "leaf";
  for (let i = 0; i < levels; i++) {
    schema = { type: "object", required: ["a"], properties: { a: schema } };
    body = { a: body };
  }

  const server = await startServer(JSON.stringify(specFor(schema)));
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // The generated response has the same nesting as the schema.
    let generated: unknown = await response.json();
    let depth = 0;
    while (
      typeof generated === "object" && generated !== null && "a" in generated
    ) {
      generated = generated.a;
      depth++;
    }
    assertEquals(response.status, 200);
    assertEquals(depth, levels);
  } finally {
    await server.stop();
  }
});

Deno.test("a chain of 100 000 $refs loads", async () => {
  const hops = 100_000;
  const schemas: Record<string, unknown> = { A0: { type: "string" } };
  for (let i = 1; i <= hops; i++) {
    schemas[`A${i}`] = { $ref: `#/components/schemas/A${i - 1}` };
  }
  const document = JSON.stringify(
    specFor({ $ref: `#/components/schemas/A${hops}` }, schemas),
  );

  const { spec, defaultedFields } = await parseSpec(document, {
    format: "json",
  });
  const analysis = analyzeSpec(spec, {
    baseUri: "file:///hostile.json",
    defaultedFields,
  });
  assertEquals(analysis.fatal, false);
});
