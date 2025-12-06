/**
 * Tests for Path Matching Utilities
 *
 * Unit tests for path pattern compilation and matching including:
 * - Basic path matching
 * - Path parameter extraction
 * - Edge cases and safety checks
 */

import { assertEquals } from "@std/assert";
import {
  compilePathPattern,
  matchCompiledPath,
  matchPathPattern,
} from "./path-matcher.ts";

// =============================================================================
// compilePathPattern Tests
// =============================================================================

Deno.test("compilePathPattern: compiles literal path", () => {
  const compiled = compilePathPattern("/api/v1/users");

  assertEquals(compiled.pattern, "/api/v1/users");
  assertEquals(compiled.segmentCount, 3);
  assertEquals(compiled.segments, [
    { type: "literal", value: "api" },
    { type: "literal", value: "v1" },
    { type: "literal", value: "users" },
  ]);
});

Deno.test("compilePathPattern: compiles path with parameter", () => {
  const compiled = compilePathPattern("/users/{id}");

  assertEquals(compiled.pattern, "/users/{id}");
  assertEquals(compiled.segmentCount, 2);
  assertEquals(compiled.segments, [
    { type: "literal", value: "users" },
    { type: "param", name: "id" },
  ]);
});

Deno.test("compilePathPattern: compiles path with multiple parameters", () => {
  const compiled = compilePathPattern("/users/{userId}/posts/{postId}");

  assertEquals(compiled.segmentCount, 4);
  assertEquals(compiled.segments, [
    { type: "literal", value: "users" },
    { type: "param", name: "userId" },
    { type: "literal", value: "posts" },
    { type: "param", name: "postId" },
  ]);
});

Deno.test("compilePathPattern: handles empty path", () => {
  const compiled = compilePathPattern("/");

  assertEquals(compiled.pattern, "/");
  assertEquals(compiled.segmentCount, 0);
  assertEquals(compiled.segments, []);
});

// =============================================================================
// matchCompiledPath Tests
// =============================================================================

Deno.test("matchCompiledPath: matches exact path", () => {
  const compiled = compilePathPattern("/api/v1/users");
  const result = matchCompiledPath("/api/v1/users", compiled);

  assertEquals(result, {});
});

Deno.test("matchCompiledPath: extracts single parameter", () => {
  const compiled = compilePathPattern("/users/{id}");
  const result = matchCompiledPath("/users/123", compiled);

  assertEquals(result, { id: "123" });
});

Deno.test("matchCompiledPath: extracts multiple parameters", () => {
  const compiled = compilePathPattern("/users/{userId}/posts/{postId}");
  const result = matchCompiledPath("/users/42/posts/abc", compiled);

  assertEquals(result, { userId: "42", postId: "abc" });
});

Deno.test("matchCompiledPath: returns null for segment count mismatch", () => {
  const compiled = compilePathPattern("/users/{id}");

  assertEquals(matchCompiledPath("/users", compiled), null);
  assertEquals(matchCompiledPath("/users/123/extra", compiled), null);
});

Deno.test("matchCompiledPath: returns null for literal mismatch", () => {
  const compiled = compilePathPattern("/users/{id}");
  const result = matchCompiledPath("/posts/123", compiled);

  assertEquals(result, null);
});

Deno.test("matchCompiledPath: decodes URL-encoded path parameters", () => {
  const compiled = compilePathPattern("/items/{name}");
  const result = matchCompiledPath("/items/hello%20world", compiled);

  assertEquals(result, { name: "hello world" });
});

Deno.test("matchCompiledPath: handles special characters in parameters", () => {
  const compiled = compilePathPattern("/files/{path}");
  const result = matchCompiledPath("/files/foo%2Fbar%2Fbaz", compiled);

  assertEquals(result, { path: "foo/bar/baz" });
});

Deno.test("matchCompiledPath: handles empty path matching empty pattern", () => {
  const compiled = compilePathPattern("/");
  const result = matchCompiledPath("/", compiled);

  assertEquals(result, {});
});

// =============================================================================
// matchPathPattern Tests (convenience function)
// =============================================================================

Deno.test("matchPathPattern: works as convenience wrapper", () => {
  const result = matchPathPattern("/users/123", "/users/{id}");
  assertEquals(result, { id: "123" });
});

Deno.test("matchPathPattern: returns null for non-matching paths", () => {
  const result = matchPathPattern("/posts/123", "/users/{id}");
  assertEquals(result, null);
});

// =============================================================================
// Edge Cases and Safety Tests
// =============================================================================

Deno.test("matchCompiledPath: handles undefined segments safely", () => {
  // This tests the explicit undefined check we added
  // In normal operation, this shouldn't happen due to length checks,
  // but the check provides defense in depth
  const compiled = compilePathPattern("/users/{id}");

  // Normal matching should work
  const result = matchCompiledPath("/users/123", compiled);
  assertEquals(result, { id: "123" });

  // Mismatched lengths should return null (not crash)
  assertEquals(matchCompiledPath("/users", compiled), null);
  assertEquals(matchCompiledPath("/users/123/extra/segments", compiled), null);
});

Deno.test("matchCompiledPath: handles trailing slashes consistently", () => {
  const compiled = compilePathPattern("/users/{id}");

  // With trailing slash in request
  const result = matchCompiledPath("/users/123/", compiled);
  // Note: the filter removes empty segments, so trailing slash is ignored
  assertEquals(result, { id: "123" });
});

Deno.test("matchCompiledPath: handles multiple consecutive slashes", () => {
  const compiled = compilePathPattern("/users/{id}");

  // Multiple slashes create empty segments which are filtered out
  const result = matchCompiledPath("//users//123", compiled);
  assertEquals(result, { id: "123" });
});

Deno.test("matchCompiledPath: handles parameter-only path", () => {
  const compiled = compilePathPattern("/{resource}/{id}");
  const result = matchCompiledPath("/users/123", compiled);

  assertEquals(result, { resource: "users", id: "123" });
});
