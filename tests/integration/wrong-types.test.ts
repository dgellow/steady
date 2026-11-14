/**
 * A parsed spec promises nothing about the type of its values. This test
 * puts a value of the wrong type at every place where the server reads a
 * structure and requires, for each resulting document:
 *
 * - loading reports the value (E1023) and does not throw
 * - no diagnostic is fatal: one unreadable value does not stop the spec
 * - requests are answered without a 5xx
 */

import { assertEquals } from "@std/assert";
import { parseSpec } from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

type Doc = Record<string, unknown>;

/** Values no structure in a spec accepts. */
const WRONG: unknown[] = [null, 5, "x", [], [1], true, { $ref: 5 }];

/** Responses that are valid in OpenAPI 3.0 and 3.1. */
const OK = { "200": { description: "ok" } };

const jsonBody = (schema: unknown) => ({
  content: { "application/json": { schema } },
});

/** A spec with one operation, built around the value under test. */
function withOperation(operation: unknown, extra: Doc = {}): Doc {
  return { paths: { "/x": { post: operation } }, ...extra };
}

function withSchema(schema: unknown): Doc {
  return withOperation({
    parameters: [{ name: "q", in: "query", schema }],
    requestBody: jsonBody(schema),
    responses: { "200": { description: "ok", ...jsonBody(schema) } },
  });
}

const SCHEMA_KEYWORDS = [
  "type",
  "properties",
  "required",
  "items",
  "prefixItems",
  "allOf",
  "oneOf",
  "anyOf",
  "not",
  "enum",
  "pattern",
  "format",
  "additionalProperties",
  "patternProperties",
  "minimum",
  "maximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "discriminator",
  "nullable",
  "examples",
  "$ref",
];

/** Places a value can sit, each as a function from the value to a spec. */
const SLOTS: Record<string, (v: unknown) => Doc> = {
  "paths": (v) => ({ paths: v }),
  "path item": (v) => ({ paths: { "/x": v } }),
  "operation": (v) => withOperation(v),
  "path item parameters": (v) => ({
    paths: { "/x": { parameters: v, post: { responses: OK } } },
  }),
  "operation parameters": (v) => withOperation({ parameters: v }),
  "parameter": (v) => withOperation({ parameters: [v], responses: OK }),
  "parameter name": (v) =>
    withOperation({ parameters: [{ name: v, in: "query" }] }),
  "parameter in": (v) => withOperation({ parameters: [{ name: "q", in: v }] }),
  "parameter required": (v) =>
    withOperation({ parameters: [{ name: "q", in: "query", required: v }] }),
  "parameter content": (v) =>
    withOperation({ parameters: [{ name: "q", in: "query", content: v }] }),
  "requestBody": (v) => withOperation({ requestBody: v, responses: OK }),
  "requestBody content": (v) => withOperation({ requestBody: { content: v } }),
  "media type": (v) =>
    withOperation({
      requestBody: { content: { "application/json": v } },
      responses: {
        "200": { description: "ok", content: { "application/json": v } },
      },
    }),
  "media type examples": (v) =>
    withOperation({
      responses: {
        "200": {
          description: "ok",
          content: { "application/json": { examples: v } },
        },
      },
    }),
  "responses": (v) => withOperation({ responses: v }),
  "response": (v) => withOperation({ responses: { "200": v } }),
  "response content": (v) =>
    withOperation({ responses: { "200": { description: "ok", content: v } } }),
  "response headers": (v) =>
    withOperation({ responses: { "200": { description: "ok", headers: v } } }),
  "response header": (v) =>
    withOperation({
      responses: { "200": { description: "ok", headers: { "X-A": v } } },
    }),
  "schema": (v) => withSchema(v),
  "components": (v) => ({ paths: {}, components: v }),
  "components.schemas": (v) => ({ paths: {}, components: { schemas: v } }),
  "component schema, referenced": (v) =>
    withOperation(
      {
        requestBody: jsonBody({ $ref: "#/components/schemas/S" }),
        responses: {
          "200": {
            description: "ok",
            ...jsonBody({ $ref: "#/components/schemas/S" }),
          },
        },
      },
      { components: { schemas: { S: v } } },
    ),
  "component parameter, referenced": (v) =>
    withOperation(
      { parameters: [{ $ref: "#/components/parameters/P" }], responses: OK },
      { components: { parameters: { P: v } } },
    ),
  "component response, referenced": (v) =>
    withOperation(
      { responses: { "200": { $ref: "#/components/responses/R" } } },
      { components: { responses: { R: v } } },
    ),
  "component requestBody, referenced": (v) =>
    withOperation(
      { requestBody: { $ref: "#/components/requestBodies/B" }, responses: OK },
      { components: { requestBodies: { B: v } } },
    ),
  "servers": (v) => ({ paths: {}, servers: v }),
  "server": (v) => ({ paths: {}, servers: [v] }),
  ...Object.fromEntries(
    SCHEMA_KEYWORDS.flatMap((keyword) => [
      [
        `schema keyword ${keyword}`,
        (v: unknown) => withSchema({ [keyword]: v }),
      ],
      [
        `nested schema keyword ${keyword}`,
        (v: unknown) =>
          withSchema({
            type: "object",
            properties: { a: { type: "array", items: { [keyword]: v } } },
          }),
      ],
    ]),
  ),
};

interface Outcome {
  threw?: string;
  fatal: string[];
  statuses: number[];
}

async function exercise(body: Doc, version: string): Promise<Outcome> {
  const document = JSON.stringify({
    openapi: version,
    info: { title: "wrong types", version: "1" },
    ...body,
  });
  const outcome: Outcome = { fatal: [], statuses: [] };
  let server: MockServer;
  try {
    const { spec, defaultedFields, shapeProblems } = await parseSpec(document, {
      format: "json",
    });
    const analysis = analyzeSpec(spec, {
      baseUri: "file:///wrong-types.json",
      defaultedFields,
      shapeProblems,
    });
    outcome.fatal = analysis.fatal
      ? analysis.diagnostics.map((d) => `${d.code} ${d.specPointer}`)
      : [];
    server = new MockServer(spec, {
      port: 0,
      host: "127.0.0.1",
      quiet: true,
      logLevel: "summary",
      startupDiagnostics: analysis.diagnostics,
      specPath: "wrong-types.json",
    }, analysis.docIndex);
  } catch (error) {
    outcome.threw = error instanceof Error
      ? `${error.constructor.name}: ${error.message}`
      : String(error);
    return outcome;
  }

  const port = await server.start();
  try {
    for (
      const init of [
        { method: "GET" },
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"a":[1,"x",{}],"kind":"k"}',
        },
        { method: "POST" },
      ]
    ) {
      const response = await fetch(
        `http://127.0.0.1:${port}/x?q=1&q=2`,
        init,
      );
      await response.body?.cancel();
      outcome.statuses.push(response.status);
    }
  } finally {
    await server.stop();
  }
  return outcome;
}

for (const version of ["3.0.3", "3.1.0"]) {
  Deno.test(`a value of the wrong type anywhere in an OpenAPI ${version} spec is reported, never fatal, never a 5xx`, async () => {
    const failures: string[] = [];
    let documents = 0;

    for (const [slot, build] of Object.entries(SLOTS)) {
      for (const value of WRONG) {
        // A string is the right type for $ref. Whether it resolves is a
        // different check (E1004, E1006).
        if (slot.endsWith("$ref") && typeof value === "string") continue;
        documents++;
        const outcome = await exercise(build(value), version);
        const label = `${slot} = ${JSON.stringify(value)}`;
        if (outcome.threw !== undefined) {
          failures.push(`${label}: threw ${outcome.threw}`);
        }
        if (outcome.fatal.length > 0) {
          failures.push(`${label}: fatal ${outcome.fatal.join(", ")}`);
        }
        for (const status of outcome.statuses) {
          if (status >= 500) failures.push(`${label}: answered ${status}`);
        }
      }
    }

    assertEquals(documents, Object.keys(SLOTS).length * WRONG.length - 2);
    assertEquals(failures, []);
  });
}
