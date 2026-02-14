import { assertEquals, assertExists } from "@std/assert";
import { isParseError, parseRequestBody } from "./body-parser.ts";

/** Helper to create a Request with a JSON body. */
function jsonRequest(
  body: string,
  headers?: Record<string, string>,
): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
}

/** Helper to create a Request with form-urlencoded body. */
function formRequest(
  body: string,
  headers?: Record<string, string>,
): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
}

/** Extract the first diagnostic from a parse error result. */
function firstDiag(result: { diagnostics: { code: string }[] }) {
  const d = result.diagnostics[0];
  assertExists(d, "Expected at least one diagnostic");
  return d;
}

Deno.test("parseRequestBody - successful JSON parse", async () => {
  const req = jsonRequest('{"name":"sam","age":30}');
  const result = await parseRequestBody(req, ["application/json"]);

  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.body, { name: "sam", age: 30 });
    assertEquals(result.contentType, "application/json");
  }
});

Deno.test("parseRequestBody - successful form parse", async () => {
  const req = formRequest("name=sam&age=30");
  const result = await parseRequestBody(req, [
    "application/x-www-form-urlencoded",
  ]);

  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.contentType, "application/x-www-form-urlencoded");
  }
});

Deno.test("parseRequestBody - invalid Content-Length (NaN)", async () => {
  const req = jsonRequest('{"a":1}', { "Content-Length": "abc" });
  const result = await parseRequestBody(req, ["application/json"]);

  assertEquals(isParseError(result), true);
  if (isParseError(result)) {
    assertEquals(result.diagnostics.length, 1);
    const d = firstDiag(result);
    assertEquals(d.code, "E3019");
  }
});

Deno.test("parseRequestBody - invalid Content-Length (negative)", async () => {
  const req = jsonRequest('{"a":1}', { "Content-Length": "-5" });
  const result = await parseRequestBody(req, ["application/json"]);

  assertEquals(isParseError(result), true);
  if (isParseError(result)) {
    const d = firstDiag(result);
    assertEquals(d.code, "E3019");
  }
});

Deno.test("parseRequestBody - empty JSON body", async () => {
  const req = jsonRequest("");
  const result = await parseRequestBody(req, ["application/json"]);

  assertEquals(isParseError(result), true);
  if (isParseError(result)) {
    const d = firstDiag(result);
    assertEquals(d.code, "E3005");
  }
});

Deno.test("parseRequestBody - malformed JSON", async () => {
  const req = jsonRequest("{invalid json}");
  const result = await parseRequestBody(req, ["application/json"]);

  assertEquals(isParseError(result), true);
  if (isParseError(result)) {
    const d = firstDiag(result);
    assertEquals(d.code, "E3021");
  }
});

Deno.test("parseRequestBody - no body on GET request", async () => {
  const req = new Request("http://localhost/test", { method: "GET" });
  const result = await parseRequestBody(req, null);

  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.body, undefined);
  }
});

Deno.test("parseRequestBody - null acceptedContentTypes allows any", async () => {
  const req = jsonRequest('{"ok":true}');
  const result = await parseRequestBody(req, null);

  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.body, { ok: true });
  }
});
