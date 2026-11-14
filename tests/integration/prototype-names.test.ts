/**
 * Names that exist on Object.prototype (toString, constructor, __proto__, ...)
 * are ordinary names in JSON, in form fields and in query strings. A lookup
 * keyed by such a name must only see what the request or the spec defines,
 * never an inherited member.
 */

import { assertEquals } from "@std/assert";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";

const SPEC = "./tests/specs/prototype-names.yaml";
const serverTestOpts = { sanitizeOps: false, sanitizeResources: false };

const INHERITED_NAMES = [
  "toString",
  "constructor",
  "hasOwnProperty",
  "valueOf",
  "__proto__",
];

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(SPEC);
  const server = new MockServer(spec, {
    port: 0,
    host: "localhost",
    logLevel: "summary",
    quiet: true,
  });
  const port = await server.start();
  try {
    await fn(`http://localhost:${port}`);
  } finally {
    await server.stop();
  }
}

/** Codes of all diagnostics reported on a response. */
function codes(response: Response): string[] {
  const count = Number(response.headers.get("X-Steady-Error-Count"));
  const result: string[] = [];
  for (let n = 1; n <= count; n++) {
    result.push(response.headers.get(`X-Steady-Error-${n}-Code`) ?? "");
  }
  return result;
}

Deno.test({
  name: "required fields named like Object.prototype members must be present",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assertEquals(missing.status, 400);
      assertEquals(codes(missing), ["E3007", "E3007"]);
      await missing.body?.cancel();

      const present = await fetch(`${baseUrl}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toString: "a", constructor: "b" }),
      });
      assertEquals(codes(present), []);
      assertEquals(present.status, 204);
    });
  },
});

Deno.test({
  name: "JSON body: an undeclared inherited name is an additional property",
  ...serverTestOpts,
  fn: async (t) => {
    await withServer(async (baseUrl) => {
      for (const name of INHERITED_NAMES) {
        await t.step(name, async () => {
          const response = await fetch(`${baseUrl}/closed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Built as text so "__proto__" is an ordinary member.
            body: `{"name":"a","${name}":"x"}`,
          });
          assertEquals(response.status, 400);
          assertEquals(codes(response), ["E3009"]);
          await response.body?.cancel();
        });
      }
    });
  },
});

Deno.test({
  name: "urlencoded form: an undeclared inherited name is an additional field",
  ...serverTestOpts,
  fn: async (t) => {
    await withServer(async (baseUrl) => {
      for (const name of INHERITED_NAMES) {
        await t.step(name, async () => {
          const response = await fetch(`${baseUrl}/form`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `name=a&${name}=x`,
          });
          assertEquals(response.status, 400);
          assertEquals(codes(response), ["E3009"]);
          await response.body?.cancel();
        });
      }
    });
  },
});

Deno.test({
  name: "multipart form: an undeclared inherited name is an additional field",
  ...serverTestOpts,
  fn: async (t) => {
    await withServer(async (baseUrl) => {
      for (const name of INHERITED_NAMES) {
        await t.step(name, async () => {
          const form = new FormData();
          form.set("name", "a");
          form.set(name, "x");
          const response = await fetch(`${baseUrl}/multipart`, {
            method: "POST",
            body: form,
          });
          assertEquals(response.status, 400);
          assertEquals(codes(response), ["E3009"]);
          await response.body?.cancel();
        });
      }
    });
  },
});

Deno.test({
  name: "deepObject query: an undeclared inherited name is an additional key",
  ...serverTestOpts,
  fn: async (t) => {
    await withServer(async (baseUrl) => {
      for (const name of INHERITED_NAMES) {
        await t.step(name, async () => {
          const response = await fetch(
            `${baseUrl}/search?filter[name]=a&filter[${name}]=x`,
          );
          assertEquals(response.status, 400);
          assertEquals(codes(response), ["E3009"]);
          await response.body?.cancel();
        });
      }
    });
  },
});
