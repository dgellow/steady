/**
 * RFC 6901 Validator Tests
 *
 * Tests for strict validation of JSON Pointer syntax according to RFC 6901.
 * https://tools.ietf.org/html/rfc6901
 */

import { assertEquals } from "@std/assert";
import {
  explainInvalidRef,
  needsEscaping,
  validatePointer,
  validateRef,
} from "./rfc6901-validator.ts";

// =============================================================================
// validatePointer Tests
// =============================================================================

Deno.test("validatePointer: empty string is valid", () => {
  const result = validatePointer("");
  assertEquals(result.valid, true);
});

Deno.test("validatePointer: root pointer '/' is valid", () => {
  const result = validatePointer("/");
  assertEquals(result.valid, true);
});

Deno.test("validatePointer: simple paths are valid", () => {
  assertEquals(validatePointer("/foo").valid, true);
  assertEquals(validatePointer("/foo/bar").valid, true);
  assertEquals(validatePointer("/foo/0").valid, true);
  assertEquals(validatePointer("/a/b/c/d/e").valid, true);
});

Deno.test("validatePointer: properly escaped sequences are valid", () => {
  assertEquals(validatePointer("/a~0b").valid, true); // ~0 for tilde
  assertEquals(validatePointer("/a~1b").valid, true); // ~1 for slash
  assertEquals(validatePointer("/~0~1").valid, true); // ~/
  assertEquals(validatePointer("/~1~0").valid, true); // /~
});

Deno.test("validatePointer: trailing slash is valid (empty string key)", () => {
  // Per RFC 6901, trailing slash indicates an empty string key
  assertEquals(validatePointer("/foo/").valid, true);
  assertEquals(validatePointer("/foo/bar/").valid, true);
});

Deno.test("validatePointer: multiple consecutive slashes are valid (multiple empty keys)", () => {
  // Per RFC 6901, // means two segments: empty string, then next token
  assertEquals(validatePointer("/foo//bar").valid, true);
  assertEquals(validatePointer("//").valid, true);
});

Deno.test("validatePointer: missing leading slash is invalid", () => {
  const result = validatePointer("foo");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("must start with '/'"), true);
  assertEquals(result.suggestion?.includes("/foo"), true);
});

Deno.test("validatePointer: hash prefix is invalid (not a pointer)", () => {
  const result = validatePointer("#/foo");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("must start with '/'"), true);
});

Deno.test("validatePointer: unescaped tilde at end of token is invalid", () => {
  const result = validatePointer("/foo~");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Unescaped tilde"), true);
  assertEquals(result.suggestion?.includes("~0"), true);
});

Deno.test("validatePointer: invalid escape sequence ~2 is invalid", () => {
  const result = validatePointer("/foo~2");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Invalid escape sequence"), true);
  assertEquals(result.error?.includes("~2"), true);
});

Deno.test("validatePointer: invalid escape sequence ~A is invalid", () => {
  const result = validatePointer("/foo~A");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Invalid escape sequence"), true);
  assertEquals(result.error?.includes("~A"), true);
});

Deno.test("validatePointer: tilde before slash (~/) is invalid", () => {
  // In "/foo~/bar", the token "foo~" ends with unescaped tilde
  // The "/" after ~ starts a new token, it doesn't form ~/ escape
  const result = validatePointer("/foo~/bar");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Unescaped tilde"), true);
});

Deno.test("validatePointer: invalid escape ~B in middle of token", () => {
  // ~B is not a valid escape sequence (only ~0 and ~1 are valid)
  const result = validatePointer("/foo~Bbar");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Invalid escape sequence"), true);
  assertEquals(result.error?.includes("~B"), true);
});

// =============================================================================
// validateRef Tests
// =============================================================================

Deno.test("validateRef: valid internal references", () => {
  assertEquals(validateRef("#").valid, true); // root
  assertEquals(validateRef("#/").valid, true); // empty string key at root
  assertEquals(validateRef("#/definitions/User").valid, true);
  assertEquals(validateRef("#/$defs/User").valid, true);
  assertEquals(validateRef("#/components/schemas/Pet").valid, true);
  assertEquals(validateRef("#/foo/bar/baz").valid, true);
});

Deno.test("validateRef: trailing slash is valid (empty string key)", () => {
  // Trailing slash = reference to empty string key
  assertEquals(validateRef("#/definitions/").valid, true);
  assertEquals(validateRef("#/$defs/").valid, true);
});

Deno.test("validateRef: anchor references are valid", () => {
  // Anchors like #myAnchor (no slash) are valid in JSON Schema
  assertEquals(validateRef("#myAnchor").valid, true);
  assertEquals(validateRef("#User").valid, true);
});

Deno.test("validateRef: double hash is invalid", () => {
  const result = validateRef("##/definitions/User");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("double hash"), true);
  assertEquals(result.suggestion?.includes("#/definitions/User"), true);
});

Deno.test("validateRef: missing hash for internal ref is invalid", () => {
  const result = validateRef("definitions");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("must start with '#'"), true);
});

Deno.test("validateRef: hash without slash when path contains slash is invalid", () => {
  const result = validateRef("#definitions/User");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("missing slash after hash"), true);
  assertEquals(result.suggestion?.includes("#/definitions/User"), true);
});

Deno.test("validateRef: external references are invalid (not supported)", () => {
  assertEquals(validateRef("https://example.com/schema.json").valid, false);
  assertEquals(validateRef("http://example.com/schema").valid, false);
  assertEquals(validateRef("file:///path/to/schema.json").valid, false);
});

Deno.test("validateRef: relative file paths are invalid (not supported)", () => {
  const result = validateRef("./schemas/user.json");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Relative file path"), true);
});

Deno.test("validateRef: backslashes are invalid", () => {
  const result = validateRef("#\\definitions\\User");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Backslashes"), true);
  assertEquals(result.suggestion?.includes("#/definitions/User"), true);
});

Deno.test("validateRef: query strings are invalid", () => {
  const result = validateRef("#/definitions/User?version=1");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Query strings"), true);
});

Deno.test("validateRef: multiple hashes are invalid", () => {
  const result = validateRef("#/foo#/bar");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Multiple fragment identifiers"), true);
});

Deno.test("validateRef: unencoded spaces are invalid", () => {
  const result = validateRef("#/foo bar");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Spaces must be percent-encoded"), true);
  assertEquals(result.suggestion?.includes("%20"), true);
});

Deno.test("validateRef: encoded spaces are valid", () => {
  assertEquals(validateRef("#/foo%20bar").valid, true);
});

Deno.test("validateRef: validates pointer part of internal ref", () => {
  // Valid pointer part
  assertEquals(validateRef("#/foo~0bar").valid, true); // ~0 for tilde
  assertEquals(validateRef("#/foo~1bar").valid, true); // ~1 for slash

  // Invalid pointer part (invalid escape sequence)
  const result = validateRef("#/foo~2bar");
  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Invalid escape sequence"), true);
});

// =============================================================================
// needsEscaping Tests
// =============================================================================

Deno.test("needsEscaping: simple tokens don't need escaping", () => {
  assertEquals(needsEscaping("foo"), false);
  assertEquals(needsEscaping("bar123"), false);
  assertEquals(needsEscaping("with-dash"), false);
  assertEquals(needsEscaping("with_underscore"), false);
  assertEquals(needsEscaping(""), false);
});

Deno.test("needsEscaping: tokens with tilde need escaping", () => {
  assertEquals(needsEscaping("foo~bar"), true);
  assertEquals(needsEscaping("~"), true);
  assertEquals(needsEscaping("a~b~c"), true);
});

Deno.test("needsEscaping: tokens with slash need escaping", () => {
  assertEquals(needsEscaping("foo/bar"), true);
  assertEquals(needsEscaping("/"), true);
  assertEquals(needsEscaping("a/b/c"), true);
});

Deno.test("needsEscaping: tokens with both tilde and slash need escaping", () => {
  assertEquals(needsEscaping("foo~/bar"), true);
  assertEquals(needsEscaping("~/"), true);
});

// =============================================================================
// explainInvalidRef Tests
// =============================================================================

Deno.test("explainInvalidRef: valid ref returns 'Reference is valid'", () => {
  const explanation = explainInvalidRef("#/definitions/User");
  assertEquals(explanation, "Reference is valid");
});

Deno.test("explainInvalidRef: invalid ref returns detailed explanation", () => {
  const explanation = explainInvalidRef("##/definitions/User");
  assertEquals(explanation.includes("Invalid reference"), true);
  assertEquals(explanation.includes("double hash"), true);
  assertEquals(explanation.includes("FIX:"), true);
});

Deno.test("explainInvalidRef: explanation includes the original ref", () => {
  const ref = "#definitions/missing-slash";
  const explanation = explainInvalidRef(ref);
  assertEquals(explanation.includes(ref), true);
});

// =============================================================================
// RFC 6901 Section 5 Examples (from the spec)
// =============================================================================

Deno.test("RFC 6901 Section 5: All examples from spec are valid pointers", () => {
  // These are the examples from RFC 6901 Section 5
  const rfcExamples = [
    "", // whole document
    "/foo", // ["bar", "baz"]
    "/foo/0", // "bar"
    "/", // 0 (empty string key maps to 0)
    "/a~1b", // 1 (key "a/b")
    "/c%d", // 2 (literal %d, NOT percent-decoded)
    "/e^f", // 3
    "/g|h", // 4
    "/i\\j", // 5 (backslash is literal in pointer, not path separator)
    '/k"l', // 6 (double quote is literal)
    "/ ", // 7 (space is literal in pointer)
    "/m~0n", // 8 (key "m~n")
  ];

  for (const pointer of rfcExamples) {
    const result = validatePointer(pointer);
    assertEquals(
      result.valid,
      true,
      `RFC 6901 example "${pointer}" should be valid: ${result.error}`,
    );
  }
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("validatePointer: very long paths are valid", () => {
  const longPath = "/" + Array(100).fill("segment").join("/");
  assertEquals(validatePointer(longPath).valid, true);
});

Deno.test("validatePointer: numeric keys are valid", () => {
  assertEquals(validatePointer("/0").valid, true);
  assertEquals(validatePointer("/123").valid, true);
  assertEquals(validatePointer("/items/0/name").valid, true);
});

Deno.test("validatePointer: unicode characters are valid", () => {
  assertEquals(validatePointer("/foo/\u00e9").valid, true); // é
  assertEquals(validatePointer("/\u4e2d\u6587").valid, true); // 中文
  assertEquals(validatePointer("/\u{1F600}").valid, true); // emoji
});

Deno.test("validateRef: percent-encoded characters are valid", () => {
  // Percent encoding is allowed (though not required for most chars)
  assertEquals(validateRef("#/foo%2Fbar").valid, true); // %2F = /
  assertEquals(validateRef("#/foo%7Ebar").valid, true); // %7E = ~
});
