import { assertEquals, assertThrows } from "@std/assert";
import {
  escapeSegment,
  exists,
  formatPointer,
  JsonPointerError,
  listPointers,
  parsePointer,
  resolve,
  set,
  unescapeSegment,
} from "./json-pointer.ts";

Deno.test("parsePointer - parses valid pointers", () => {
  assertEquals(parsePointer(""), []);
  assertEquals(parsePointer("/"), [""]);
  assertEquals(parsePointer("/foo"), ["foo"]);
  assertEquals(parsePointer("/foo/bar"), ["foo", "bar"]);
  assertEquals(parsePointer("/foo/0"), ["foo", "0"]);
  assertEquals(parsePointer("/a~1b"), ["a/b"]);
  assertEquals(parsePointer("/a~0b"), ["a~b"]);
  assertEquals(parsePointer("/~0~1"), ["~/"]);
  assertEquals(parsePointer("/foo/bar/baz"), ["foo", "bar", "baz"]);
});

Deno.test("parsePointer - rejects invalid pointers", () => {
  assertThrows(
    () => parsePointer("foo"),
    JsonPointerError,
    "must start with '/' or be empty string",
  );
  assertThrows(
    () => parsePointer("#/foo"),
    JsonPointerError,
    "must start with '/' or be empty string",
  );
});

Deno.test("escapeSegment - escapes special characters", () => {
  assertEquals(escapeSegment("simple"), "simple");
  assertEquals(escapeSegment("has/slash"), "has~1slash");
  assertEquals(escapeSegment("has~tilde"), "has~0tilde");
  assertEquals(escapeSegment("has~/both"), "has~0~1both");
  assertEquals(escapeSegment(""), "");
});

Deno.test("unescapeSegment - unescapes special characters", () => {
  assertEquals(unescapeSegment("simple"), "simple");
  assertEquals(unescapeSegment("has~1slash"), "has/slash");
  assertEquals(unescapeSegment("has~0tilde"), "has~tilde");
  assertEquals(unescapeSegment("has~0~1both"), "has~/both");
  assertEquals(unescapeSegment(""), "");
});

Deno.test("formatPointer - formats path segments", () => {
  assertEquals(formatPointer([]), "");
  assertEquals(formatPointer([""]), "/");
  assertEquals(formatPointer(["foo"]), "/foo");
  assertEquals(formatPointer(["foo", "bar"]), "/foo/bar");
  assertEquals(formatPointer(["a/b", "c~d"]), "/a~1b/c~0d");
});

Deno.test("resolve - resolves valid pointers", () => {
  const doc = {
    foo: "bar",
    baz: { qux: "hello" },
    arr: [1, 2, { nested: "value" }],
    "key/with/slashes": "value",
    "key~with~tildes": "value",
  };

  assertEquals(resolve(doc, ""), doc);
  assertEquals(resolve(doc, "/foo"), "bar");
  assertEquals(resolve(doc, "/baz"), { qux: "hello" });
  assertEquals(resolve(doc, "/baz/qux"), "hello");
  assertEquals(resolve(doc, "/arr"), [1, 2, { nested: "value" }]);
  assertEquals(resolve(doc, "/arr/0"), 1);
  assertEquals(resolve(doc, "/arr/1"), 2);
  assertEquals(resolve(doc, "/arr/2"), { nested: "value" });
  assertEquals(resolve(doc, "/arr/2/nested"), "value");
  assertEquals(resolve(doc, "/key~1with~1slashes"), "value");
  assertEquals(resolve(doc, "/key~0with~0tildes"), "value");
});

Deno.test("resolve - handles edge cases", () => {
  assertEquals(resolve(null, ""), null);
  assertEquals(resolve(undefined, ""), undefined);
  assertEquals(resolve(0, ""), 0);
  assertEquals(resolve(false, ""), false);
  assertEquals(resolve("string", ""), "string");
  assertEquals(resolve([], ""), []);
  assertEquals(resolve({}, ""), {});
});

Deno.test("resolve - throws for invalid references", () => {
  const doc = { foo: { bar: "baz" }, arr: [1, 2, 3] };

  assertThrows(
    () => resolve(doc, "/nonexistent"),
    JsonPointerError,
    "Property 'nonexistent' not found",
  );

  assertThrows(
    () => resolve(doc, "/foo/bar/baz"),
    JsonPointerError,
    "not an object or array",
  );

  assertThrows(
    () => resolve(doc, "/arr/3"),
    JsonPointerError,
    "Array index 3 out of bounds",
  );

  assertThrows(
    () => resolve(doc, "/arr/-"),
    JsonPointerError,
    "Cannot resolve '-' array index",
  );

  assertThrows(
    () => resolve(doc, "/arr/invalid"),
    JsonPointerError,
    "Invalid array index",
  );

  assertThrows(
    () => resolve(null, "/foo"),
    JsonPointerError,
    "current value is null/undefined",
  );
});

Deno.test("exists - checks pointer existence", () => {
  const doc = {
    foo: null,
    bar: undefined,
    baz: false,
    arr: [1, 2, 3],
  };

  assertEquals(exists(doc, ""), true);
  assertEquals(exists(doc, "/foo"), true);
  assertEquals(exists(doc, "/bar"), true);
  assertEquals(exists(doc, "/baz"), true);
  assertEquals(exists(doc, "/arr/0"), true);
  assertEquals(exists(doc, "/nonexistent"), false);
  assertEquals(exists(doc, "/foo/bar"), false);
  assertEquals(exists(doc, "/arr/5"), false);
});

Deno.test("set - sets values at pointer locations", () => {
  const doc = { foo: { bar: "old" }, arr: [1, 2, 3] };

  set(doc, "/foo/bar", "new");
  assertEquals(doc.foo.bar, "new");

  set(doc, "/foo/baz", "added");
  assertEquals((doc.foo as Record<string, unknown>).baz, "added");

  set(doc, "/arr/1", 42);
  assertEquals(doc.arr[1], 42);

  set(doc, "/arr/-", 4);
  assertEquals(doc.arr, [1, 42, 3, 4]);

  set(doc, "/newProp", { nested: "value" });
  assertEquals((doc as Record<string, unknown>).newProp, { nested: "value" });
});

Deno.test("set - throws for invalid operations", () => {
  const doc = { foo: "string", arr: [1, 2] };

  assertThrows(
    () => set(doc, "", "value"),
    JsonPointerError,
    "Cannot set root document",
  );

  assertThrows(
    () => set(doc, "/foo/bar", "value"),
    JsonPointerError,
    "not an object or array",
  );

  assertThrows(
    () => set(doc, "/arr/5", "value"),
    JsonPointerError,
    "Array index 5 out of bounds",
  );

  assertThrows(
    () => set(null, "/foo", "value"),
    JsonPointerError,
    "path is null/undefined",
  );
});

Deno.test("listPointers - lists all pointers", () => {
  const doc = {
    foo: "bar",
    baz: {
      qux: "hello",
      nested: { deep: "value" },
    },
    arr: [1, { item: "two" }],
  };

  const pointers = listPointers(doc);
  const expected = [
    "",
    "/foo",
    "/baz",
    "/baz/qux",
    "/baz/nested",
    "/baz/nested/deep",
    "/arr",
    "/arr/0",
    "/arr/1",
    "/arr/1/item",
  ];

  assertEquals(new Set(pointers), new Set(expected));
});

Deno.test("listPointers - with prefix", () => {
  const doc = {
    foo: { bar: { baz: "value" } },
    other: "data",
  };

  assertEquals(
    new Set(listPointers(doc, "/foo")),
    new Set([
      "/foo",
      "/foo/bar",
      "/foo/bar/baz",
    ]),
  );

  assertEquals(listPointers(doc, "/nonexistent"), []);
});

Deno.test("roundtrip - parse and format", () => {
  const pointers = [
    "",
    "/",
    "/foo",
    "/foo/bar",
    "/foo/0/bar",
    "/a~1b",
    "/a~0b",
    "/~0~1",
    "/very/long/path/with/many/segments",
  ];

  for (const original of pointers) {
    const parsed = parsePointer(original);
    const formatted = formatPointer(parsed);
    assertEquals(formatted, original, `Roundtrip failed for: ${original}`);
  }
});

Deno.test("RFC 6901 examples", () => {
  // Examples from RFC 6901 Section 5
  const doc = {
    "foo": ["bar", "baz"],
    "": 0,
    "a/b": 1,
    "c%d": 2,
    "e^f": 3,
    "g|h": 4,
    "i\\j": 5,
    'k"l': 6,
    " ": 7,
    "m~n": 8,
  };

  assertEquals(resolve(doc, ""), doc);
  assertEquals(resolve(doc, "/foo"), ["bar", "baz"]);
  assertEquals(resolve(doc, "/foo/0"), "bar");
  assertEquals(resolve(doc, "/"), 0);
  assertEquals(resolve(doc, "/a~1b"), 1);
  assertEquals(resolve(doc, "/c%d"), 2);
  assertEquals(resolve(doc, "/e^f"), 3);
  assertEquals(resolve(doc, "/g|h"), 4);
  assertEquals(resolve(doc, "/i\\j"), 5);
  assertEquals(resolve(doc, '/k"l'), 6);
  assertEquals(resolve(doc, "/ "), 7);
  assertEquals(resolve(doc, "/m~0n"), 8);
});

// =============================================================================
// RFC 6901 COMPLIANCE TESTS - Percent encoding is NOT part of RFC 6901
// =============================================================================

Deno.test("RFC 6901: percent sequences are NOT decoded (they are literal characters)", () => {
  // RFC 6901 only defines ~0 (tilde) and ~1 (slash) escaping.
  // Percent-encoding like %20 is NOT part of RFC 6901.
  // A key with literal "%20" in it should be accessed with "/foo%20bar", not "/ ".

  const doc = {
    "foo%20bar": "value with literal percent sequence",
    "foo bar": "value with actual space",
  };

  // Accessing "/foo%20bar" should find the key "foo%20bar" (literal percent)
  // NOT decode it to "foo bar"
  assertEquals(resolve(doc, "/foo%20bar"), "value with literal percent sequence");

  // Accessing the space key requires the literal space (which RFC 6901 allows)
  assertEquals(resolve(doc, "/foo bar"), "value with actual space");
});

Deno.test("RFC 6901: escapeSegment and unescapeSegment are symmetric", () => {
  // Any segment that goes through escape -> unescape should come back identical
  const testCases = [
    "simple",
    "with/slash",
    "with~tilde",
    "with~/both",
    "with%20percent",     // Literal percent sequence - should NOT be decoded
    "with%2Fslash",       // Literal %2F - should NOT become /
    "complex%20~0~1test", // Mixed cases
    "",
  ];

  for (const original of testCases) {
    const escaped = escapeSegment(original);
    const unescaped = unescapeSegment(escaped);
    assertEquals(
      unescaped,
      original,
      `Roundtrip failed for segment: "${original}" -> escaped: "${escaped}" -> unescaped: "${unescaped}"`,
    );
  }
});

Deno.test("RFC 6901: array index must be exact non-negative integer string", () => {
  const doc = { arr: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] };

  // Valid indices should work
  assertEquals(resolve(doc, "/arr/0"), "a");
  assertEquals(resolve(doc, "/arr/1"), "b");
  assertEquals(resolve(doc, "/arr/10"), "k");

  // Leading zeros should be rejected (per RFC 6901, indices are integers without leading zeros)
  assertThrows(
    () => resolve(doc, "/arr/01"),
    JsonPointerError,
    "Invalid array index",
  );

  assertThrows(
    () => resolve(doc, "/arr/00"),
    JsonPointerError,
    "Invalid array index",
  );

  // Decimal numbers should be rejected
  assertThrows(
    () => resolve(doc, "/arr/1.5"),
    JsonPointerError,
    "Invalid array index",
  );

  // Negative with leading zero
  assertThrows(
    () => resolve(doc, "/arr/-1"),
    JsonPointerError,
    "Invalid array index",
  );

  // Spaces should be rejected
  assertThrows(
    () => resolve(doc, "/arr/ 1"),
    JsonPointerError,
    "Invalid array index",
  );

  assertThrows(
    () => resolve(doc, "/arr/1 "),
    JsonPointerError,
    "Invalid array index",
  );
});
