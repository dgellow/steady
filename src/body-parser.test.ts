import { assertEquals, assertExists } from "@std/assert";
import { parseRequestBody } from "./body-parser.ts";
import { getMediaType } from "./media-type.ts";

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

/**
 * A request whose body is a stream and that has no Content-Type header.
 * `new Request(url, { body: "text" })` would add one on its own.
 */
function unlabelledRequest(method: string, chunks: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const req = new Request("http://localhost/test", { method, body: stream });
  assertEquals(req.headers.get("content-type"), null);
  return req;
}

Deno.test("parseRequestBody - successful JSON parse", async () => {
  const result = await parseRequestBody(jsonRequest('{"name":"sam","age":30}'));

  assertEquals(result, {
    kind: "parsed",
    value: { name: "sam", age: 30 },
    mediaType: getMediaType("application/json"),
  });
});

Deno.test("parseRequestBody - successful form parse", async () => {
  const result = await parseRequestBody(formRequest("name=sam&age=30"));

  assertEquals(result.kind, "parsed");
  if (result.kind === "parsed") {
    assertEquals(result.mediaType, "application/x-www-form-urlencoded");
    assertEquals(result.rawFormKeys, ["name", "age"]);
  }
});

Deno.test("parseRequestBody - multipart form parse", async () => {
  const form = new FormData();
  form.set("name", "sam");
  const req = new Request("http://localhost/test", {
    method: "POST",
    body: form,
  });
  const result = await parseRequestBody(req);

  assertEquals(result.kind, "parsed");
  if (result.kind === "parsed") {
    assertEquals(result.mediaType, "multipart/form-data");
    assertEquals(result.rawFormKeys, ["name"]);
  }
});

Deno.test("parseRequestBody - other content types are read as text", async () => {
  const req = new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: "hello",
  });

  assertEquals(await parseRequestBody(req), {
    kind: "parsed",
    value: "hello",
    mediaType: getMediaType("text/plain"),
  });
});

Deno.test("parseRequestBody - unparseable Content-Type keeps the text, media type unknown", async () => {
  const req = new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": ";;;" },
    body: "hello",
  });

  assertEquals(await parseRequestBody(req), {
    kind: "parsed",
    value: "hello",
    mediaType: null,
  });
});

for (const length of ["abc", "-5"]) {
  Deno.test(`parseRequestBody - invalid Content-Length "${length}"`, async () => {
    const req = jsonRequest('{"a":1}', { "Content-Length": length });
    const result = await parseRequestBody(req);

    assertEquals(result.kind, "invalid");
    if (result.kind === "invalid") {
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]?.code, "E3019");
    }
  });
}

Deno.test("parseRequestBody - malformed JSON", async () => {
  const result = await parseRequestBody(jsonRequest("{invalid json}"));

  assertEquals(result.kind, "invalid");
  if (result.kind === "invalid") {
    const first = result.diagnostics[0];
    assertExists(first);
    assertEquals(first.code, "E3021");
  }
});

Deno.test("parseRequestBody - QUERY and DELETE bodies are parsed", async () => {
  for (const method of ["QUERY", "DELETE"]) {
    const req = new Request("http://localhost/search", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    const result = await parseRequestBody(req);

    assertEquals(result.kind, "parsed", method);
    if (result.kind === "parsed") assertEquals(result.value, { q: "test" });
  }
});

// ── No body ────────────────────────────────────────────────────────
//
// "Absent" means zero bytes. Whether that is a problem depends on the spec
// (requestBody.required), so the diagnostic engine decides, not the parser.

Deno.test("parseRequestBody - request without a body is absent", async () => {
  for (const method of ["GET", "DELETE"]) {
    const req = new Request("http://localhost/test", { method });
    assertEquals(await parseRequestBody(req), { kind: "absent" }, method);
  }
});

Deno.test("parseRequestBody - zero bytes are absent whatever the Content-Type", async () => {
  // SDKs commonly send Content-Type: application/json on every request,
  // including DELETE and cancel endpoints that have no body.
  for (
    const contentType of [
      "application/json",
      "application/x-www-form-urlencoded",
      "text/plain",
      "application/octet-stream",
    ]
  ) {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: "",
    });
    assertEquals(await parseRequestBody(req), { kind: "absent" }, contentType);
  }
});

Deno.test("parseRequestBody - empty stream without Content-Type is absent", async () => {
  // Deno's HTTP server gives every request a body stream, also bodyless ones.
  const req = unlabelledRequest("DELETE", []);
  assertEquals(await parseRequestBody(req), { kind: "absent" });
});

// ── Body without Content-Type ──────────────────────────────────────

Deno.test("parseRequestBody - bytes without Content-Type are unlabelled, not absent", async () => {
  const req = unlabelledRequest("POST", ['{"name":', '"sam"}']);

  assertEquals(await parseRequestBody(req), {
    kind: "unlabelled",
    byteLength: 14,
  });
});
