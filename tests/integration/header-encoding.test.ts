/**
 * Response header values that carry text from the request or the spec.
 *
 * HTTP field values are ASCII. A diagnostic message can quote a property
 * name or a value from the request, so any character can reach a header.
 * Each test goes through the full pipeline against a real server.
 */

import { assertEquals } from "@std/assert";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";

const SPEC = "./tests/specs/header-encoding.yaml";
const serverTestOpts = { sanitizeOps: false, sanitizeResources: false };

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

function postUser(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name: "diagnostic for a non-ASCII property name is reported, not a 500",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      const response = await postUser(baseUrl, { name: "a", "名前": 1 });
      assertEquals(response.status, 400);
      assertEquals(response.headers.get("X-Steady-Request-Valid"), "false");
      assertEquals(response.headers.get("X-Steady-Error-Count"), "1");
      assertEquals(response.headers.get("X-Steady-Error-1-Code"), "E3009");

      const path = response.headers.get("X-Steady-Error-1-Path") ?? "";
      const message = response.headers.get("X-Steady-Error-1-Message") ?? "";
      assertEquals(decodeURIComponent(message).includes("名前"), true, message);
      // The raw header value is plain ASCII.
      assertEquals(/^[\x20-\x7e]*$/.test(message), true, message);

      // The body carries the same diagnostic unencoded.
      const body = await response.json();
      assertEquals(body.steady.errors[0].path, decodeURIComponent(path));
      assertEquals(body.steady.errors[0].message, decodeURIComponent(message));
    });
  },
});

Deno.test({
  name: "diagnostic for a property name with control characters is reported",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      const response = await postUser(baseUrl, {
        name: "a",
        "x\r\ny\u0000": 1,
      });
      assertEquals(response.status, 400);
      assertEquals(response.headers.get("X-Steady-Error-1-Code"), "E3009");
      const message = response.headers.get("X-Steady-Error-1-Message") ?? "";
      assertEquals(
        decodeURIComponent(message).includes("x\r\ny\u0000"),
        true,
        message,
      );
    });
  },
});

Deno.test({
  name: "diagnostic quoting a non-ASCII value is reported",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      // Wrong type for 'name': the message may quote the received value.
      const response = await postUser(baseUrl, { name: ["\u{1F600} 名前"] });
      assertEquals(response.status, 400);
      assertEquals(response.headers.get("X-Steady-Request-Valid"), "false");
      assertEquals(response.headers.get("X-Steady-Error-1-Code"), "E3008");
    });
  },
});

Deno.test({
  name: "routing diagnostic for a path with non-ASCII characters is reported",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/名前`);
      assertEquals(response.status, 404);
      assertEquals(response.headers.get("X-Steady-Error-1-Code"), "E2001");
      const path = response.headers.get("X-Steady-Error-1-Path") ?? "";
      assertEquals(decodeURIComponent(path), "/%E5%90%8D%E5%89%8D");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name: "Location from the spec with non-ASCII characters is a valid URI",
  ...serverTestOpts,
  fn: async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/moved`, { redirect: "manual" });
      assertEquals(response.status, 302);
      assertEquals(
        response.headers.get("Location"),
        "/caf%C3%A9/%E5%90%8D%E5%89%8D?q=a%20b",
      );
      await response.body?.cancel();
    });
  },
});
