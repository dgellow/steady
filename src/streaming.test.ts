/**
 * Tests for streaming response generator (NDJSON and SSE)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createStreamingResponse,
  getStreamFormat,
  isSSEEventSequence,
  isStreamingContentType,
  parseStreamingOptions,
  STREAMING_CONTENT_TYPES,
} from "./streaming.ts";
import { SchemaRegistry } from "@steady/json-schema";

Deno.test("isStreamingContentType: recognizes NDJSON content types", () => {
  assertEquals(isStreamingContentType("application/x-ndjson"), true);
  assertEquals(isStreamingContentType("application/jsonl"), true);
  assertEquals(isStreamingContentType("application/json-seq"), true);
});

Deno.test("isStreamingContentType: recognizes SSE content type", () => {
  assertEquals(isStreamingContentType("text/event-stream"), true);
});

Deno.test("isStreamingContentType: rejects non-streaming types", () => {
  assertEquals(isStreamingContentType("application/json"), false);
  assertEquals(isStreamingContentType("text/plain"), false);
  assertEquals(isStreamingContentType("text/html"), false);
});

Deno.test("isStreamingContentType: handles content type with parameters", () => {
  assertEquals(
    isStreamingContentType("application/x-ndjson; charset=utf-8"),
    true,
  );
  assertEquals(
    isStreamingContentType("text/event-stream; charset=utf-8"),
    true,
  );
});

Deno.test("isStreamingContentType: is case insensitive", () => {
  assertEquals(isStreamingContentType("APPLICATION/X-NDJSON"), true);
  assertEquals(isStreamingContentType("Text/Event-Stream"), true);
});

Deno.test("getStreamFormat: returns ndjson for NDJSON types", () => {
  assertEquals(getStreamFormat("application/x-ndjson"), "ndjson");
  assertEquals(getStreamFormat("application/jsonl"), "ndjson");
  assertEquals(getStreamFormat("application/json-seq"), "ndjson");
});

Deno.test("getStreamFormat: returns sse for SSE type", () => {
  assertEquals(getStreamFormat("text/event-stream"), "sse");
});

Deno.test("getStreamFormat: returns null for non-streaming types", () => {
  assertEquals(getStreamFormat("application/json"), null);
  assertEquals(getStreamFormat("text/plain"), null);
});

Deno.test("parseStreamingOptions: parses count header", () => {
  const req = new Request("http://localhost/test", {
    headers: { "X-Steady-Stream-Count": "10" },
  });
  const options = parseStreamingOptions(req);
  assertEquals(options.count, 10);
});

Deno.test("parseStreamingOptions: parses interval header", () => {
  const req = new Request("http://localhost/test", {
    headers: { "X-Steady-Stream-Interval-Ms": "200" },
  });
  const options = parseStreamingOptions(req);
  assertEquals(options.interval, 200);
});

Deno.test("parseStreamingOptions: ignores invalid count", () => {
  const req = new Request("http://localhost/test", {
    headers: { "X-Steady-Stream-Count": "abc" },
  });
  const options = parseStreamingOptions(req);
  assertEquals(options.count, undefined);
});

Deno.test("parseStreamingOptions: rejects count over 1000", () => {
  const req = new Request("http://localhost/test", {
    headers: { "X-Steady-Stream-Count": "5000" },
  });
  const options = parseStreamingOptions(req);
  assertEquals(options.count, undefined);
});

Deno.test("parseStreamingOptions: rejects negative interval", () => {
  const req = new Request("http://localhost/test", {
    headers: { "X-Steady-Stream-Interval-Ms": "-100" },
  });
  const options = parseStreamingOptions(req);
  assertEquals(options.interval, undefined);
});

Deno.test("createStreamingResponse: generates NDJSON stream", async () => {
  const doc = {
    type: "object",
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
    },
    required: ["id", "name"],
  };

  const registry = new SchemaRegistry({ schema: doc });
  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "ndjson",
    { count: 3, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  // Split by newlines and parse
  const lines = fullText.trim().split("\n");
  assertEquals(lines.length, 3);

  // Each line should be valid JSON
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assertEquals(typeof parsed._stream, "object");
    assertEquals(typeof parsed._stream.index, "number");
    assertEquals(typeof parsed._stream.total, "number");
    assertEquals(parsed._stream.total, 3);
  }
});

Deno.test("createStreamingResponse: generates SSE stream", async () => {
  const doc = {
    type: "object",
    properties: {
      value: { type: "integer" },
    },
  };

  const registry = new SchemaRegistry({ schema: doc });
  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { count: 2, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  // SSE format should have id, event, and data lines
  assertStringIncludes(fullText, "id: 0");
  assertStringIncludes(fullText, "event: message");
  assertStringIncludes(fullText, "data: {");
  // Should end with done event
  assertStringIncludes(fullText, "event: done");
});

Deno.test("createStreamingResponse: uses deterministic seeds", async () => {
  const doc = {
    type: "object",
    properties: {
      id: { type: "integer" },
    },
  };

  const registry = new SchemaRegistry({ schema: doc });

  // Generate twice with same seed
  const stream1 = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "ndjson",
    { count: 2, interval: 0, generatorOptions: { seed: 42 } },
  );

  const stream2 = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "ndjson",
    { count: 2, interval: 0, generatorOptions: { seed: 42 } },
  );

  const readAll = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    return text;
  };

  const text1 = await readAll(stream1);
  const text2 = await readAll(stream2);

  // Parse and compare data (ignoring timestamps which will differ)
  const lines1 = text1.trim().split("\n").map((l) => {
    const obj = JSON.parse(l);
    delete obj._stream.timestamp;
    return obj;
  });
  const lines2 = text2.trim().split("\n").map((l) => {
    const obj = JSON.parse(l);
    delete obj._stream.timestamp;
    return obj;
  });

  assertEquals(lines1, lines2);
});

Deno.test("createStreamingResponse: handles $ref schemas", async () => {
  const doc = {
    components: {
      schemas: {
        Event: {
          type: "object",
          properties: {
            type: { type: "string" },
          },
        },
      },
    },
  };

  const registry = new SchemaRegistry(doc);
  const stream = createStreamingResponse(
    registry,
    { $ref: "#/components/schemas/Event" },
    "#/test",
    "ndjson",
    { count: 1, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  const lines = fullText.trim().split("\n");
  assertEquals(lines.length, 1);
  const parsed = JSON.parse(lines[0]!);
  assertEquals(typeof parsed._stream, "object");
});

Deno.test("STREAMING_CONTENT_TYPES: contains all expected types", () => {
  assertEquals(STREAMING_CONTENT_TYPES.includes("application/x-ndjson"), true);
  assertEquals(STREAMING_CONTENT_TYPES.includes("application/jsonl"), true);
  assertEquals(STREAMING_CONTENT_TYPES.includes("application/json-seq"), true);
  assertEquals(STREAMING_CONTENT_TYPES.includes("text/event-stream"), true);
});

// SSE Example Sequence Tests

Deno.test("isSSEEventSequence: recognizes valid event sequences", () => {
  const validSequence = [
    { event: "message", data: { text: "Hello" } },
    { event: "progress", data: { percent: 50 } },
    { event: "done", data: {} },
  ];
  assertEquals(isSSEEventSequence(validSequence), true);
});

Deno.test("isSSEEventSequence: accepts events with only data field", () => {
  const dataOnly = [
    { data: { text: "Hello" } },
    { data: { text: "World" } },
  ];
  assertEquals(isSSEEventSequence(dataOnly), true);
});

Deno.test("isSSEEventSequence: rejects non-array", () => {
  assertEquals(isSSEEventSequence({ data: "test" }), false);
  assertEquals(isSSEEventSequence("test"), false);
  assertEquals(isSSEEventSequence(null), false);
});

Deno.test("isSSEEventSequence: rejects empty array", () => {
  assertEquals(isSSEEventSequence([]), false);
});

Deno.test("isSSEEventSequence: rejects array without event/data fields", () => {
  const invalidSequence = [
    { text: "Hello" },
    { text: "World" },
  ];
  assertEquals(isSSEEventSequence(invalidSequence), false);
});

Deno.test("createStreamingResponse: SSE with example event sequence", async () => {
  const doc = { type: "object" };
  const registry = new SchemaRegistry({ schema: doc });

  const exampleEvents = [
    { event: "start", data: { message: "Starting..." } },
    { event: "progress", data: { percent: 50 } },
    { event: "complete", data: { result: "success" } },
  ];

  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { example: exampleEvents, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  // Should have the three events
  assertStringIncludes(fullText, "event: start");
  assertStringIncludes(fullText, "event: progress");
  assertStringIncludes(fullText, "event: complete");
  assertStringIncludes(fullText, '"message":"Starting..."');
  assertStringIncludes(fullText, '"percent":50');
  assertStringIncludes(fullText, '"result":"success"');

  // Should NOT have auto-added done event (last event is "complete")
  // Count occurrences of "event: done" - should be 0
  const doneMatches = fullText.match(/event: done/g);
  assertEquals(doneMatches, null);
});

Deno.test("createStreamingResponse: SSE adds done event if missing", async () => {
  const doc = { type: "object" };
  const registry = new SchemaRegistry({ schema: doc });

  const exampleEvents = [
    { event: "message", data: { text: "Hello" } },
    { event: "message", data: { text: "World" } },
  ];

  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { example: exampleEvents, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  // Should have auto-added done event since last wasn't done/complete/end
  assertStringIncludes(fullText, "event: done");
});

Deno.test("createStreamingResponse: SSE supports custom event IDs", async () => {
  const doc = { type: "object" };
  const registry = new SchemaRegistry({ schema: doc });

  const exampleEvents = [
    { id: "evt-001", event: "message", data: { text: "Hello" } },
    { id: "evt-002", event: "done", data: {} },
  ];

  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { example: exampleEvents, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  assertStringIncludes(fullText, "id: evt-001");
  assertStringIncludes(fullText, "id: evt-002");
});

Deno.test("createStreamingResponse: SSE supports retry field", async () => {
  const doc = { type: "object" };
  const registry = new SchemaRegistry({ schema: doc });

  const exampleEvents = [
    { event: "message", data: { text: "Hello" }, retry: 5000 },
    { event: "done", data: {} },
  ];

  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { example: exampleEvents, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  assertStringIncludes(fullText, "retry: 5000");
});

Deno.test("createStreamingResponse: SSE schema-based adds done event", async () => {
  const doc = {
    type: "object",
    properties: { value: { type: "integer" } },
  };

  const registry = new SchemaRegistry({ schema: doc });
  const stream = createStreamingResponse(
    registry,
    doc,
    "#/schema",
    "sse",
    { count: 2, interval: 0 },
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value);
  }

  // Schema-based SSE should end with done event
  assertStringIncludes(fullText, "event: done\ndata: {}");
});
