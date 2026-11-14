/**
 * Which findings reject a request.
 *
 * Steady answers 400 when the SDK sent the request wrong (`sdk-issue`) and
 * serves the mock response for everything else: content notes and findings
 * it cannot attribute. Getting this boundary wrong in one direction rejects
 * correct requests, in the other it waves SDK bugs through. Each case here
 * sends one request through a server built the way the CLI builds it and
 * asserts the status, the validity header and the reported code.
 */

import { assertEquals } from "@std/assert";
import { parseSpec } from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

const SPEC = {
  openapi: "3.1.0",
  info: { title: "boundary", version: "1" },
  paths: {
    "/things": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 3, maxLength: 5 },
                  amount: { type: "number", multipleOf: 5, maximum: 100 },
                  kind: { const: "thing" },
                  color: { enum: ["red", "green"] },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 2,
                    uniqueItems: true,
                  },
                  // A closed object: additional properties are forbidden.
                  closed: {
                    type: "object",
                    properties: { a: { type: "string" } },
                    additionalProperties: false,
                  },
                  // Optional, and its schema is a component.
                  shipping: { $ref: "#/components/schemas/Address" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
  components: {
    schemas: {
      Address: {
        type: "object",
        required: ["city"],
        properties: {
          city: { type: "string" },
          // Required inside the optional `shipping`.
          geo: {
            type: "object",
            required: ["lat"],
            properties: { lat: { type: "number" } },
          },
        },
      },
    },
  },
};

interface Outcome {
  status: number;
  valid: string | null;
  codes: string[];
}

async function send(body: unknown): Promise<Outcome> {
  const { spec, defaultedFields, shapeProblems } = await parseSpec(
    JSON.stringify(SPEC),
    { format: "json" },
  );
  const analysis = analyzeSpec(spec, {
    baseUri: "file:///boundary.json",
    defaultedFields,
    shapeProblems,
  });
  const server = new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    logLevel: "summary",
    startupDiagnostics: analysis.diagnostics,
    specPath: "boundary.json",
  }, analysis.docIndex);
  const port = await server.start();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/things`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await response.body?.cancel();
    const count = Number(response.headers.get("x-steady-error-count") ?? "0");
    const codes: string[] = [];
    for (let i = 1; i <= count; i++) {
      const code = response.headers.get(`x-steady-error-${i}-code`);
      if (code !== null) codes.push(code);
    }
    return {
      status: response.status,
      valid: response.headers.get("x-steady-request-valid"),
      codes,
    };
  } finally {
    await server.stop();
  }
}

Deno.test("a correct request is served with no finding at all", async () => {
  assertEquals(
    await send({
      name: "abcd",
      amount: 10,
      kind: "thing",
      color: "red",
      tags: ["a", "b"],
      closed: { a: "x" },
    }),
    { status: 200, valid: "true", codes: [] },
  );
});

// Content notes: the SDK transported a value of the right type in the right
// place. What the value contains is not the SDK's doing.
const CONTENT_NOTES: [string, unknown, string][] = [
  ["string shorter than minLength", { name: "ab" }, "E4003"],
  ["string longer than maxLength", { name: "abcdefgh" }, "E4003"],
  ["number that is not a multiple", { name: "abc", amount: 7 }, "E4007"],
  ["number above maximum", { name: "abc", amount: 500 }, "E4004"],
  [
    "array longer than maxItems",
    { name: "abc", tags: ["a", "b", "c"] },
    "E4005",
  ],
  ["array with duplicate items", { name: "abc", tags: ["a", "a"] }, "E4002"],
];

for (const [title, body, code] of CONTENT_NOTES) {
  Deno.test(`content note, not rejected: ${title} (${code})`, async () => {
    assertEquals(await send(body), {
      status: 200,
      valid: "true",
      codes: [code],
    });
  });
}

// JSON Schema allows properties a schema does not mention unless
// `additionalProperties` says otherwise. The registry has a code for this
// case (E5003, ambiguous), but the validator only reports an additional
// property when the schema forbids it, so nothing is reported here.
Deno.test("not a finding: a property the schema neither declares nor forbids", async () => {
  assertEquals(await send({ name: "abc", undeclared: 1 }), {
    status: 200,
    valid: "true",
    codes: [],
  });
});

Deno.test("ambiguous, not rejected: optional object sent without its required field (E3013)", async () => {
  assertEquals(await send({ name: "abc", shipping: {} }), {
    status: 200,
    valid: "true",
    codes: ["E3013"],
  });
  // `geo` is optional in the address as well.
  assertEquals(await send({ name: "abc", shipping: { city: "x", geo: {} } }), {
    status: 200,
    valid: "true",
    codes: ["E3013"],
  });
});

// SDK issues: the request has the wrong structure.
const SDK_ISSUES: [string, unknown, string][] = [
  ["missing required property", {}, "E3007"],
  ["wrong type", { name: 5 }, "E3008"],
  ["value that is not the const", { name: "abc", kind: "other" }, "E3017"],
  ["value outside the enum", { name: "abc", color: "blue" }, "E3016"],
  [
    "property the schema forbids",
    { name: "abc", closed: { a: "x", b: 1 } },
    "E3009",
  ],
  ["array item of the wrong type", { name: "abc", tags: [1] }, "E3010"],
];

for (const [title, body, code] of SDK_ISSUES) {
  Deno.test(`SDK issue, rejected: ${title} (${code})`, async () => {
    assertEquals(await send(body), {
      status: 400,
      valid: "false",
      codes: [code],
    });
  });
}

Deno.test("a content note next to an SDK issue does not hide it", async () => {
  const outcome = await send({ name: "ab", color: "blue" });
  assertEquals(outcome.status, 400);
  assertEquals(outcome.valid, "false");
  assertEquals(outcome.codes.sort(), ["E3016", "E4003"]);
});
