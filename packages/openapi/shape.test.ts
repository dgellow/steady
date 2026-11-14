import { assertEquals } from "@std/assert";
import { formatFragmentPointer } from "@steady/json-pointer";
import { normalizeSpecShape } from "./shape.ts";

function normalize(spec: Record<string, unknown>): string[] {
  return normalizeSpecShape(spec).map((p) =>
    `${formatFragmentPointer(p.path)}: ${
      p.message ?? `expected ${p.expected}, found ${p.actual}`
    }`
  );
}

const OK = { "200": { description: "ok" } };

Deno.test("normalizeSpecShape: a well-formed spec is left alone", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    servers: [{ url: "https://example.test" }],
    paths: {
      "/users/{id}": {
        parameters: [{ name: "id", in: "path", required: true }],
        get: {
          parameters: [{ $ref: "#/components/parameters/Limit" }],
          responses: {
            "200": {
              description: "ok",
              headers: { "X-Total": { schema: { type: "integer" } } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                  examples: { a: { value: { id: "1" } } },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: { type: "object" },
                encoding: { file: { contentType: "image/png" } },
              },
            },
          },
          responses: OK,
        },
      },
    },
    components: {
      schemas: {
        User: { type: "object", properties: { id: { type: "string" } } },
      },
      parameters: { Limit: { name: "limit", in: "query" } },
      responses: { Error: { description: "error" } },
    },
  };
  const before = JSON.stringify(spec);
  assertEquals(normalize(spec), []);
  assertEquals(JSON.stringify(spec), before);
});

Deno.test("normalizeSpecShape: wrong-typed nodes are reported at their location and removed", () => {
  const spec: Record<string, unknown> = {
    paths: {
      "/a": null,
      "/b": {
        get: 5,
        post: {
          parameters: [
            "x",
            { name: "ok", in: "query" },
            { name: 5, in: "query" },
            { name: "where", in: "body" },
            { name: "flag", in: "query", required: "yes" },
          ],
          requestBody: { content: 5 },
          responses: { "200": { description: "ok", content: [] }, "404": 7 },
        },
      },
    },
    components: { schemas: [] },
    servers: [{ url: 5 }, { url: "https://example.test" }],
  };
  assertEquals(normalize(spec).sort(), [
    "#/components/schemas: expected an object, found array",
    "#/paths/~1a: expected an object, found null",
    "#/paths/~1b/get: expected an object, found number",
    "#/paths/~1b/post/parameters/0: expected a parameter object, found string",
    "#/paths/~1b/post/parameters/2: expected a parameter with a string name, found object",
    '#/paths/~1b/post/parameters/3: expected a parameter with "in" set to path, query, header or cookie, found object',
    "#/paths/~1b/post/parameters/4/required: expected a boolean, found string",
    "#/paths/~1b/post/requestBody/content: expected an object, found number",
    "#/paths/~1b/post/responses/200/content: expected an object, found array",
    "#/paths/~1b/post/responses/404: expected an object, found number",
    "#/servers/0: expected a server object with a string url, found object",
  ]);
  assertEquals(spec, {
    paths: {
      "/b": {
        post: {
          parameters: [
            { name: "ok", in: "query" },
            { name: "flag", in: "query" },
          ],
          requestBody: { content: {} },
          responses: { "200": { description: "ok" } },
        },
      },
    },
    components: {},
    servers: [{ url: "https://example.test" }],
  });
});

Deno.test("normalizeSpecShape: responses that lose every entry are removed, not left empty", () => {
  const spec: Record<string, unknown> = {
    paths: { "/a": { get: { responses: { "200": 5 } } } },
  };
  normalize(spec);
  // An empty responses object is itself invalid in OpenAPI 3.1.
  assertEquals(spec, { paths: { "/a": { get: {} } } });
});

Deno.test("normalizeSpecShape: boolean schemas at OpenAPI positions become their object form", () => {
  const spec: Record<string, unknown> = {
    paths: {
      "/a": {
        post: {
          parameters: [{ name: "q", in: "query", schema: true }],
          requestBody: { content: { "application/json": { schema: false } } },
          responses: OK,
        },
      },
    },
    components: {
      schemas: {
        Any: true,
        // Nested booleans stay: the validator handles them.
        Closed: { type: "object", additionalProperties: false },
      },
    },
  };
  assertEquals(normalize(spec), []);
  assertEquals(spec, {
    paths: {
      "/a": {
        post: {
          parameters: [{ name: "q", in: "query", schema: {} }],
          requestBody: {
            content: { "application/json": { schema: { not: {} } } },
          },
          responses: OK,
        },
      },
    },
    components: {
      schemas: {
        Any: {},
        Closed: { type: "object", additionalProperties: false },
      },
    },
  });
});

Deno.test("normalizeSpecShape: references into a removed value are removed with it", () => {
  // From a published spec: `allOf` written as an object with numeric keys,
  // and references that point into it by index.
  const spec: Record<string, unknown> = {
    paths: {
      "/monsters/{index}": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { allOf: { "0": { type: "object" } } },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Monster: {
          properties: {
            base: {
              $ref:
                "#/paths/~1monsters~1%7Bindex%7D/get/responses/200/content/application~1json/schema/allOf/0",
              description: "kept",
            },
            other: { $ref: "#/components/schemas/Other" },
          },
        },
        Other: { type: "string" },
      },
    },
  };
  assertEquals(normalize(spec), [
    "#/paths/~1monsters~1{index}/get/responses/200/content/application~1json/schema/allOf: expected an array of schemas, found object",
    "#/components/schemas/Monster/properties/base/$ref: Reference to #/paths/~1monsters~1%7Bindex%7D/get/responses/200/content/application~1json/schema/allOf/0, which is inside #/paths/~1monsters~1{index}/get/responses/200/content/application~1json/schema/allOf, a value Steady ignores. Steady ignores this reference too",
  ]);
  const schemas = spec.components;
  assertEquals(schemas, {
    schemas: {
      Monster: {
        properties: {
          base: { description: "kept" },
          other: { $ref: "#/components/schemas/Other" },
        },
      },
      Other: { type: "string" },
    },
  });
});

Deno.test("normalizeSpecShape: a parameter that only referred to a removed component goes too", () => {
  const spec: Record<string, unknown> = {
    paths: {
      "/a": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/Bad" },
            { name: "ok", in: "query" },
          ],
          responses: OK,
        },
      },
    },
    components: { parameters: { Bad: 5 } },
  };
  const problems = normalize(spec);
  assertEquals(problems.length, 3);
  assertEquals(
    problems[0],
    "#/components/parameters/Bad: expected an object, found number",
  );
  assertEquals(spec.paths, {
    "/a": {
      get: { parameters: [{ name: "ok", in: "query" }], responses: OK },
    },
  });
});
