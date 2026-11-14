import { assertEquals } from "@std/assert";
import {
  essenceMatches,
  getMediaType,
  getStreamingFormat,
  isBinaryMediaType,
  isFormMediaType,
  isJsonMediaType,
  isNdjsonMediaType,
  isSseMediaType,
  isStreamingMediaType,
  isWildcard,
  negotiateMediaType,
  parseAccept,
} from "./media-type.ts";
import type { MediaTypeEssence } from "./media-type.ts";

/** Helper to create a MediaTypeEssence from a literal for testing classification functions. */
function essence(s: string): MediaTypeEssence {
  return s as MediaTypeEssence;
}

// =============================================================================
// getMediaType
// =============================================================================

Deno.test("getMediaType: extracts essence without parameters", () => {
  assertEquals(getMediaType("application/json"), "application/json");
});

Deno.test("getMediaType: strips charset parameter", () => {
  assertEquals(
    getMediaType("application/json; charset=utf-8"),
    "application/json",
  );
});

Deno.test("getMediaType: strips boundary parameter", () => {
  assertEquals(
    getMediaType("multipart/form-data; boundary=----WebKitFormBoundary"),
    "multipart/form-data",
  );
});

Deno.test("getMediaType: strips multiple parameters", () => {
  assertEquals(
    getMediaType("text/html; charset=utf-8; boundary=something"),
    "text/html",
  );
});

Deno.test("getMediaType: normalizes to lowercase", () => {
  assertEquals(
    getMediaType("Application/JSON"),
    "application/json",
  );
});

Deno.test("getMediaType: returns null on empty input", () => {
  assertEquals(getMediaType(""), null);
});

// =============================================================================
// isWildcard
// =============================================================================

Deno.test("isWildcard: matches */*", () => {
  assertEquals(isWildcard(essence("*/*")), true);
});

Deno.test("isWildcard: rejects non-wildcard", () => {
  assertEquals(isWildcard(essence("application/json")), false);
  assertEquals(isWildcard(essence("text/plain")), false);
});

// =============================================================================
// essenceMatches
// =============================================================================

Deno.test("essenceMatches: exact match", () => {
  assertEquals(
    essenceMatches(essence("application/json"), essence("application/json")),
    true,
  );
});

Deno.test("essenceMatches: wildcard pattern matches any candidate", () => {
  assertEquals(
    essenceMatches(essence("application/json"), essence("*/*")),
    true,
  );
  assertEquals(
    essenceMatches(essence("text/plain"), essence("*/*")),
    true,
  );
});

Deno.test("essenceMatches: non-wildcard mismatch", () => {
  assertEquals(
    essenceMatches(essence("application/json"), essence("text/plain")),
    false,
  );
});

Deno.test("essenceMatches: wildcard candidate does not match non-wildcard pattern", () => {
  assertEquals(
    essenceMatches(essence("*/*"), essence("application/json")),
    false,
  );
});

Deno.test("essenceMatches: subtype wildcard pattern matches same type only", () => {
  // OpenAPI allows media type ranges such as image/* as content keys.
  assertEquals(essenceMatches(essence("image/png"), essence("image/*")), true);
  assertEquals(
    essenceMatches(essence("text/plain"), essence("image/*")),
    false,
  );
  assertEquals(essenceMatches(essence("image/*"), essence("image/*")), true);
  assertEquals(essenceMatches(essence("image/*"), essence("image/png")), false);
});

// =============================================================================
// parseAccept (RFC 9110 section 12.5.1)
// =============================================================================

Deno.test("parseAccept: missing weight defaults to 1", () => {
  assertEquals(parseAccept("application/json").entries, [
    { range: essence("application/json"), q: 1 },
  ]);
});

Deno.test("parseAccept: keeps source order and reads weights", () => {
  assertEquals(
    parseAccept("text/plain;q=0.5, application/json, */*;q=0.1").entries,
    [
      { range: essence("text/plain"), q: 0.5 },
      { range: essence("application/json"), q: 1 },
      { range: essence("*/*"), q: 0.1 },
    ],
  );
});

Deno.test("parseAccept: q=0 and q=0.0 are kept as weight 0", () => {
  assertEquals(parseAccept("application/json;q=0, text/plain;q=0.0").entries, [
    { range: essence("application/json"), q: 0 },
    { range: essence("text/plain"), q: 0 },
  ]);
});

Deno.test("parseAccept: weight parameter name is case-insensitive", () => {
  assertEquals(parseAccept("application/json;Q=0.25").entries, [
    { range: essence("application/json"), q: 0.25 },
  ]);
});

Deno.test("parseAccept: weights outside the qvalue grammar are read leniently", () => {
  // The grammar is 0 with up to three decimals or 1 with up to three zeros.
  // Clients do not all follow it: Java's HttpURLConnection sends "q=.2".
  assertEquals(
    parseAccept("a/b;q=.5, c/d;q=0.1234, e/f;q=1.5, g/h;q=5").entries,
    [
      { range: essence("a/b"), q: 0.5 },
      { range: essence("c/d"), q: 0.1234 },
      { range: essence("e/f"), q: 1 },
      { range: essence("g/h"), q: 1 },
    ],
  );
});

Deno.test("parseAccept: a weight that is not a number is ignored", () => {
  assertEquals(parseAccept("a/b;q=abc, c/d;q=-1").entries, [
    { range: essence("a/b"), q: 1 },
    { range: essence("c/d"), q: 1 },
  ]);
});

Deno.test("parseAccept: members that are not a media range are skipped", () => {
  assertEquals(parseAccept("*, json, , text/plain"), {
    entries: [{ range: essence("text/plain"), q: 1 }],
    malformed: false,
  });
});

Deno.test("parseAccept: malformed only when no member can be read at all", () => {
  assertEquals(parseAccept(";;;"), { entries: [], malformed: true });
  assertEquals(parseAccept(""), { entries: [], malformed: true });
  // Readable, though not type/subtype ranges: lenient servers ignore them.
  assertEquals(parseAccept("*"), { entries: [], malformed: false });
  assertEquals(parseAccept("json"), { entries: [], malformed: false });
});

Deno.test("parseAccept: a comma inside a quoted parameter does not split the member", () => {
  assertEquals(parseAccept('foo/bar;x="a,b";q=0.2, text/plain').entries, [
    { range: essence("foo/bar"), q: 0.2 },
    { range: essence("text/plain"), q: 1 },
  ]);
});

// =============================================================================
// negotiateMediaType
// =============================================================================

function negotiate(accept: string, available: string[]) {
  return negotiateMediaType(
    parseAccept(accept).entries,
    available.map(essence),
  );
}

Deno.test("negotiateMediaType: q=0 excludes a type", () => {
  assertEquals(
    negotiate("application/json;q=0, text/plain", [
      "application/json",
      "text/plain",
    ]),
    { index: 1, range: essence("text/plain") },
  );
});

Deno.test("negotiateMediaType: highest weight wins regardless of header order", () => {
  assertEquals(
    negotiate("text/plain;q=0.5, application/json", [
      "text/plain",
      "application/json",
    ]),
    { index: 1, range: essence("application/json") },
  );
});

Deno.test("negotiateMediaType: equal weights follow header order, then available order", () => {
  assertEquals(
    negotiate("text/plain, application/json", [
      "application/json",
      "text/plain",
    ]),
    { index: 1, range: essence("text/plain") },
  );
  assertEquals(
    negotiate("*/*", ["application/json", "text/plain"]),
    { index: 0, range: essence("*/*") },
  );
});

Deno.test("negotiateMediaType: the most specific range decides a type's weight", () => {
  // */* would allow JSON, but the exact entry forbids it.
  assertEquals(
    negotiate("*/*, application/json;q=0", ["application/json", "text/plain"]),
    { index: 1, range: essence("*/*") },
  );
  // text/* outranks */* for text/plain.
  assertEquals(
    negotiate("*/*;q=0.9, text/*;q=0.1, application/json;q=0.5", [
      "text/plain",
      "application/json",
    ]),
    { index: 1, range: essence("application/json") },
  );
});

Deno.test("negotiateMediaType: an available range reports the concrete accept range", () => {
  assertEquals(
    negotiate("application/json", ["*/*"]),
    { index: 0, range: essence("application/json") },
  );
  assertEquals(
    negotiate("image/png;q=0.5, image/webp", ["text/plain", "image/*"]),
    { index: 1, range: essence("image/webp") },
  );
});

Deno.test("negotiateMediaType: nothing acceptable returns null", () => {
  assertEquals(negotiate("text/plain", ["application/json"]), null);
  assertEquals(negotiate("application/json;q=0", ["application/json"]), null);
  assertEquals(negotiate("", ["application/json"]), null);
  assertEquals(negotiate("*/*", []), null);
});

// =============================================================================
// isJsonMediaType (WHATWG MIME Sniffing Standard)
// =============================================================================

Deno.test("isJsonMediaType: application/json", () => {
  assertEquals(isJsonMediaType(essence("application/json")), true);
});

Deno.test("isJsonMediaType: text/json", () => {
  assertEquals(isJsonMediaType(essence("text/json")), true);
});

Deno.test("isJsonMediaType: vendor +json suffix", () => {
  assertEquals(isJsonMediaType(essence("application/vnd.api+json")), true);
});

Deno.test("isJsonMediaType: problem+json", () => {
  assertEquals(isJsonMediaType(essence("application/problem+json")), true);
});

Deno.test("isJsonMediaType: rejects application/xml", () => {
  assertEquals(isJsonMediaType(essence("application/xml")), false);
});

Deno.test("isJsonMediaType: rejects text/plain", () => {
  assertEquals(isJsonMediaType(essence("text/plain")), false);
});

Deno.test("isJsonMediaType: rejects application/octet-stream", () => {
  assertEquals(isJsonMediaType(essence("application/octet-stream")), false);
});

// =============================================================================
// isFormMediaType
// =============================================================================

Deno.test("isFormMediaType: multipart/form-data", () => {
  assertEquals(isFormMediaType(essence("multipart/form-data")), true);
});

Deno.test("isFormMediaType: application/x-www-form-urlencoded", () => {
  assertEquals(
    isFormMediaType(essence("application/x-www-form-urlencoded")),
    true,
  );
});

Deno.test("isFormMediaType: rejects application/json", () => {
  assertEquals(isFormMediaType(essence("application/json")), false);
});

// =============================================================================
// isBinaryMediaType
// =============================================================================

Deno.test("isBinaryMediaType: application/octet-stream", () => {
  assertEquals(isBinaryMediaType(essence("application/octet-stream")), true);
});

Deno.test("isBinaryMediaType: image types", () => {
  assertEquals(isBinaryMediaType(essence("image/png")), true);
  assertEquals(isBinaryMediaType(essence("image/jpeg")), true);
});

Deno.test("isBinaryMediaType: audio/video types", () => {
  assertEquals(isBinaryMediaType(essence("audio/mpeg")), true);
  assertEquals(isBinaryMediaType(essence("video/mp4")), true);
});

Deno.test("isBinaryMediaType: rejects text and JSON", () => {
  assertEquals(isBinaryMediaType(essence("text/plain")), false);
  assertEquals(isBinaryMediaType(essence("application/json")), false);
});

// =============================================================================
// isNdjsonMediaType
// =============================================================================

Deno.test("isNdjsonMediaType: recognizes all NDJSON variants", () => {
  assertEquals(isNdjsonMediaType(essence("application/x-ndjson")), true);
  assertEquals(isNdjsonMediaType(essence("application/ndjson")), true);
  assertEquals(isNdjsonMediaType(essence("application/jsonl")), true);
  assertEquals(isNdjsonMediaType(essence("application/x-jsonl")), true);
  assertEquals(isNdjsonMediaType(essence("application/jsonlines")), true);
  assertEquals(isNdjsonMediaType(essence("application/x-jsonlines")), true);
  assertEquals(isNdjsonMediaType(essence("application/json-lines")), true);
  assertEquals(isNdjsonMediaType(essence("application/x-ldjson")), true);
  assertEquals(isNdjsonMediaType(essence("application/json-seq")), true);
  assertEquals(isNdjsonMediaType(essence("text/x-ndjson")), true);
});

Deno.test("isNdjsonMediaType: rejects non-NDJSON", () => {
  assertEquals(isNdjsonMediaType(essence("application/json")), false);
  assertEquals(isNdjsonMediaType(essence("text/event-stream")), false);
});

// =============================================================================
// isSseMediaType
// =============================================================================

Deno.test("isSseMediaType: text/event-stream", () => {
  assertEquals(isSseMediaType(essence("text/event-stream")), true);
});

Deno.test("isSseMediaType: rejects non-SSE", () => {
  assertEquals(isSseMediaType(essence("application/x-ndjson")), false);
  assertEquals(isSseMediaType(essence("text/plain")), false);
});

// =============================================================================
// isStreamingMediaType
// =============================================================================

Deno.test("isStreamingMediaType: matches NDJSON and SSE", () => {
  assertEquals(isStreamingMediaType(essence("application/x-ndjson")), true);
  assertEquals(isStreamingMediaType(essence("text/event-stream")), true);
});

Deno.test("isStreamingMediaType: rejects non-streaming", () => {
  assertEquals(isStreamingMediaType(essence("application/json")), false);
  assertEquals(isStreamingMediaType(essence("text/plain")), false);
});

// =============================================================================
// getStreamingFormat
// =============================================================================

Deno.test("getStreamingFormat: returns ndjson for NDJSON types", () => {
  assertEquals(getStreamingFormat(essence("application/x-ndjson")), "ndjson");
  assertEquals(getStreamingFormat(essence("application/jsonl")), "ndjson");
});

Deno.test("getStreamingFormat: returns sse for SSE", () => {
  assertEquals(getStreamingFormat(essence("text/event-stream")), "sse");
});

Deno.test("getStreamingFormat: returns null for non-streaming", () => {
  assertEquals(getStreamingFormat(essence("application/json")), null);
  assertEquals(getStreamingFormat(essence("text/plain")), null);
});
