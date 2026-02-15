/**
 * Edge Case Tests: Malformed $ref Syntax
 *
 * Tests for messy, real-world OpenAPI specs with incorrectly formatted $refs.
 * These are COMMON mistakes in real specs that break many tools.
 *
 * USER REQUIREMENT: "openapi spec are often messy in complicated ways in the real world"
 *
 * RFC 6901 Compliance: This test suite enforces STRICT RFC 6901 compliance for
 * JSON Pointer syntax. Malformed $refs MUST be rejected with clear error messages.
 */

import { assertEquals, assertExists } from "@std/assert";
import { JsonSchemaProcessor } from "../../../packages/json-schema/processor.ts";
import type { Schema } from "../../../packages/json-schema/types.ts";

Deno.test("EDGE: $ref with double hash (common typo)", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "##/definitions/User" }, // Double hash - common typo
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Should fail with clear error message
  assertEquals(result.valid, false, "Should reject double hash in $ref");
  assertEquals(
    result.errors.length > 0,
    true,
    "Should have at least one error",
  );

  // Error should mention the specific problem
  const errorMessages = result.errors.map((e) => e.message.toLowerCase()).join(
    " ",
  );
  assertEquals(
    errorMessages.includes("ref") || errorMessages.includes("reference"),
    true,
    "Error should mention ref/reference",
  );
});

Deno.test("EDGE: $ref with trailing slash", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/" }, // Trailing slash
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Trailing slash is valid RFC 6901 syntax (empty string key).
  // The ref is syntactically correct but the target doesn't exist.
  // Resolution failures are non-fatal; the diagnostics engine (E1004)
  // handles unresolvable refs with full context.
  assertEquals(result.valid, true, "Syntactically valid ref per RFC 6901");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/components/schemas/"),
    false,
    "Unresolvable ref should not appear in resolved map",
  );
});

Deno.test("EDGE: $ref missing slash after hash", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#components/schemas/User" }, // Missing / after #
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Should fail - invalid pointer format per RFC 6901
  assertEquals(
    result.valid,
    false,
    "Should reject missing slash after # per RFC 6901",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref missing hash", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "components/schemas/User" }, // Missing #
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Missing hash could be external ref, but without proper URI scheme should fail
  assertEquals(
    result.valid,
    false,
    "Should fail to resolve ref without # (not external)",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref with spaces", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/User Name" }, // Space in name - not encoded
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Should fail - spaces must be percent-encoded as %20 per RFC 6901
  assertEquals(
    result.valid,
    false,
    "Should reject unencoded spaces in $ref per RFC 6901",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref with URL-encoded characters", () => {
  const schema: Schema = {
    $defs: {
      "User Name": { type: "string" }, // Name with space
    },
    properties: {
      user: { $ref: "#/$defs/User%20Name" }, // Properly encoded
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Should work - RFC 6901 allows percent-encoding
  assertEquals(
    result.valid,
    true,
    "Should accept URL-encoded $ref per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
});

Deno.test("EDGE: $ref with backslashes (Windows paths)", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#\\components\\schemas\\User" }, // Backslashes
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Should fail - JSON Pointers use forward slashes per RFC 6901
  assertEquals(
    result.valid,
    false,
    "Should reject backslashes in $ref per RFC 6901",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref with query string", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/User?version=2" }, // Query string
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Query strings are not valid in JSON Pointers per RFC 6901
  assertEquals(
    result.valid,
    false,
    "Should reject query string in $ref per RFC 6901",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref with fragment identifier twice", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas#User" }, // Two fragments
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Multiple fragments invalid per RFC 6901
  assertEquals(
    result.valid,
    false,
    "Should reject multiple fragments in $ref per RFC 6901",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");
});

Deno.test("EDGE: $ref with dots in path", () => {
  const schema: Schema = {
    $defs: {
      "User.Admin": { type: "string" }, // Dot in name
    },
    properties: {
      user: { $ref: "#/$defs/User.Admin" },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Dots are valid in JSON Pointer tokens per RFC 6901
  assertEquals(result.valid, true, "Should accept dots in $ref per RFC 6901");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/User.Admin"),
    true,
    "Should resolve ref with dots",
  );
});

Deno.test("EDGE: $ref with empty string as key", () => {
  const schema: Schema = {
    $defs: {
      "": { type: "string" }, // Empty string as key
    },
    properties: {
      user: { $ref: "#/$defs/" }, // Ref to empty string key
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Empty string is valid JSON object key, and "//" is valid pointer per RFC 6901
  assertEquals(
    result.valid,
    true,
    "Should accept empty string in $ref per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/"),
    true,
    "Should resolve ref to empty string key",
  );
});

Deno.test("EDGE: $ref with tilde not escaped - RFC 6901 VIOLATION", () => {
  const schema: Schema = {
    $defs: {
      "User~Admin": { type: "string" }, // Tilde in name
    },
    properties: {
      user: { $ref: "#/$defs/User~Admin" }, // Not properly escaped
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // RFC 6901: Tilde MUST be escaped as ~0
  // STRICT COMPLIANCE: Reject unescaped tildes
  assertEquals(
    result.valid,
    false,
    "Should reject unescaped tilde per RFC 6901 (MUST be ~0)",
  );
  assertEquals(result.errors.length > 0, true, "Should have errors");

  // NOTE: Some implementations may be lenient, but Steady enforces RFC 6901
});

Deno.test("EDGE: $ref with properly escaped tilde - RFC 6901 COMPLIANT", () => {
  const schema: Schema = {
    $defs: {
      "User~Admin": { type: "string" }, // Tilde in name
    },
    properties: {
      user: { $ref: "#/$defs/User~0Admin" }, // Properly escaped per RFC 6901
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Properly escaped should work per RFC 6901
  assertEquals(
    result.valid,
    true,
    "Should accept properly escaped tilde (~0) per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
});

Deno.test("EDGE: $ref with slash not escaped - RFC 6901 AMBIGUOUS", () => {
  const schema: Schema = {
    $defs: {
      "User/Admin": { type: "string" }, // Slash in name (unusual)
    },
    properties: {
      user: { $ref: "#/$defs/User/Admin" }, // Ambiguous - could be nested path
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // RFC 6901 treats "/" as a path separator: resolves $defs -> "User" -> "Admin".
  // Since $defs has key "User/Admin" (not separate "User" and "Admin" keys),
  // this ref doesn't match. Use ~1 to escape slashes in key names.
  assertEquals(result.valid, true, "Syntactically valid per RFC 6901");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/User/Admin"),
    false,
    "Unescaped slash ref should NOT resolve to key 'User/Admin'",
  );
});

Deno.test("EDGE: $ref with properly escaped slash - RFC 6901 COMPLIANT", () => {
  const schema: Schema = {
    $defs: {
      "User/Admin": { type: "string" }, // Slash in name
    },
    properties: {
      user: { $ref: "#/$defs/User~1Admin" }, // Properly escaped per RFC 6901
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Properly escaped should work per RFC 6901
  assertEquals(
    result.valid,
    true,
    "Should accept properly escaped slash (~1) per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/User~1Admin"),
    true,
    "Should resolve ref with escaped slash",
  );
});

Deno.test("EDGE: $ref pointing to non-existent deep path", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p" }, // Very deep, doesn't exist
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // The ref is syntactically valid RFC 6901 but the target path doesn't
  // exist. Resolution failures are non-fatal; E1004 handles reporting.
  assertEquals(result.valid, true, "Syntactically valid ref per RFC 6901");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.resolved.has("#/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p"),
    false,
    "Unresolvable ref should not appear in resolved map",
  );
});

Deno.test("EDGE: $ref with array index syntax", () => {
  // Intentionally malformed: $defs should be Record<string, Schema>, not array
  const schema = {
    $defs: [
      { type: "string" },
      { type: "number" },
    ],
    properties: {
      user: { $ref: "#/$defs/0" }, // Array index
    },
  } as unknown as Schema;

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // $defs as array is unusual but valid JSON
  // Numeric indices should work per RFC 6901
  assertEquals(result.valid, true, "Should handle array $defs per RFC 6901");
  assertExists(result.schema, "Should return processed schema");
});

Deno.test("EDGE: $ref with negative array index as string key", () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/$defs/-1" }, // Looks like negative index
    },
    $defs: {
      "-1": { type: "string" }, // String key "-1", not array index
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // "-1" as string key should work - it's a valid object key
  assertEquals(
    result.valid,
    true,
    "Should handle string key that looks like negative index",
  );
  assertExists(result.schema, "Should return processed schema");
});

Deno.test("EDGE: $ref with siblings (JSON Schema 2020-12 behavior)", () => {
  // In JSON Schema 2020-12, keywords that are siblings to $ref are ignored
  const schema: Schema = {
    $ref: "#/$defs/A",
    properties: {
      // This should be ignored in JSON Schema 2020-12
      foo: { type: "string" },
    },
    $defs: {
      A: { type: "object" },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Schema should be valid per JSON Schema 2020-12
  assertEquals(
    result.valid,
    true,
    "Should process $ref with siblings per JSON Schema 2020-12",
  );
  assertExists(result.schema, "Should return processed schema");

  // Should warn about ignored keywords
  assertEquals(
    result.warnings.length > 0,
    true,
    "Should warn about sibling keywords to $ref being ignored",
  );

  // Verify warning mentions ignored siblings
  const warningMessages = result.warnings.map((w) => w.message.toLowerCase())
    .join(" ");
  assertEquals(
    warningMessages.includes("sibling") || warningMessages.includes("ignored"),
    true,
    "Warning should mention siblings are ignored",
  );
});

Deno.test("EDGE: RFC 6901 escape sequence ~0 (represents ~)", () => {
  const schema: Schema = {
    $defs: {
      "foo~bar": { type: "string" }, // Literal tilde in key
    },
    properties: {
      test: { $ref: "#/$defs/foo~0bar" }, // ~0 = literal ~
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Per RFC 6901: ~0 represents literal ~
  assertEquals(
    result.valid,
    true,
    "Should handle ~0 escape sequence per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
});

Deno.test("EDGE: RFC 6901 escape sequence ~1 (represents /)", () => {
  const schema: Schema = {
    $defs: {
      "foo/bar": { type: "string" }, // Literal slash in key
    },
    properties: {
      test: { $ref: "#/$defs/foo~1bar" }, // ~1 = literal /
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = processor.process(schema);

  // Per RFC 6901: ~1 represents literal /
  assertEquals(
    result.valid,
    true,
    "Should handle ~1 escape sequence per RFC 6901",
  );
  assertExists(result.schema, "Should return processed schema");
});
