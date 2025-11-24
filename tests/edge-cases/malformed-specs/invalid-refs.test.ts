/**
 * Edge Case Tests: Malformed $ref Syntax
 *
 * Tests for messy, real-world OpenAPI specs with incorrectly formatted $refs.
 * These are COMMON mistakes in real specs that break many tools.
 *
 * USER REQUIREMENT: "openapi spec are often messy in complicated ways in the real world"
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { JsonSchemaProcessor } from "../../../packages/json-schema/processor.ts";
import type { Schema } from "../../../packages/json-schema/types.ts";

Deno.test("EDGE: $ref with double hash (common typo)", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "##/definitions/User" }, // Double hash - common typo
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail with clear error message
  assertEquals(result.valid, false, "Should reject double hash in $ref");
  assertEquals(
    result.errors.some((e) =>
      e.message.toLowerCase().includes("invalid") ||
      e.message.toLowerCase().includes("ref")
    ),
    true,
    "Should provide clear error about invalid $ref",
  );
});

Deno.test("EDGE: $ref with trailing slash", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/" }, // Trailing slash
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail - empty name after trailing slash
  assertEquals(result.valid, false, "Should reject trailing slash in $ref");
});

Deno.test("EDGE: $ref missing slash after hash", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#components/schemas/User" }, // Missing / after #
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail - invalid pointer format
  assertEquals(result.valid, false, "Should reject missing slash after #");
});

Deno.test("EDGE: $ref missing hash", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "components/schemas/User" }, // Missing #
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Missing hash could be interpreted as external ref or as error
  // Current behavior: should fail to resolve
  assertEquals(result.valid, false, "Should fail to resolve ref without #");
});

Deno.test("EDGE: $ref with spaces", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/User Name" }, // Space in name
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail unless properly encoded
  // This is a common issue - spaces should be %20 in JSON pointers
  assertEquals(result.valid, false, "Should reject unencoded spaces in $ref");
});

Deno.test("EDGE: $ref with URL-encoded characters", async () => {
  const schema: Schema = {
    $defs: {
      "User Name": { type: "string" }, // Name with space
    },
    properties: {
      user: { $ref: "#/$defs/User%20Name" }, // Properly encoded
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should work if properly encoded
  // JSON Pointer RFC 6901 allows percent-encoding
  assertEquals(result.valid, true, "Should accept URL-encoded $ref");
});

Deno.test("EDGE: $ref with backslashes (Windows paths)", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#\\components\\schemas\\User" }, // Backslashes
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail - JSON Pointers use forward slashes
  assertEquals(result.valid, false, "Should reject backslashes in $ref");
});

Deno.test("EDGE: $ref with query string", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas/User?version=2" }, // Query string
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Query strings not valid in JSON Pointers
  assertEquals(result.valid, false, "Should reject query string in $ref");
});

Deno.test("EDGE: $ref with fragment identifier twice", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/components/schemas#User" }, // Two fragments
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Multiple fragments invalid
  assertEquals(result.valid, false, "Should reject multiple fragments in $ref");
});

Deno.test("EDGE: $ref with dots in path", async () => {
  const schema: Schema = {
    $defs: {
      "User.Admin": { type: "string" }, // Dot in name
    },
    properties: {
      user: { $ref: "#/$defs/User.Admin" },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Dots are valid in JSON Pointer tokens
  assertEquals(result.valid, true, "Should accept dots in $ref");
  assertEquals(
    result.schema!.refs.resolved.has("#/$defs/User.Admin"),
    true,
    "Should resolve ref with dots",
  );
});

Deno.test("EDGE: $ref with empty string as key", async () => {
  const schema: Schema = {
    $defs: {
      "": { type: "string" }, // Empty string as key
    },
    properties: {
      user: { $ref: "#/$defs/" }, // Ref to empty string key
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Empty string is valid JSON object key
  assertEquals(result.valid, true, "Should accept empty string in $ref");
  assertEquals(
    result.schema!.refs.resolved.has("#/$defs/"),
    true,
    "Should resolve ref to empty string key",
  );
});

Deno.test("EDGE: $ref with tilde not escaped", async () => {
  const schema: Schema = {
    $defs: {
      "User~Admin": { type: "string" }, // Tilde in name
    },
    properties: {
      user: { $ref: "#/$defs/User~Admin" }, // Not properly escaped
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Tilde must be escaped as ~0 in JSON Pointers
  // But we're lenient and handle it
  assertEquals(
    result.valid,
    true,
    "Should handle unescaped tilde (lenient)",
  );
});

Deno.test("EDGE: $ref with properly escaped tilde", async () => {
  const schema: Schema = {
    $defs: {
      "User~Admin": { type: "string" }, // Tilde in name
    },
    properties: {
      user: { $ref: "#/$defs/User~0Admin" }, // Properly escaped
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Properly escaped should work
  assertEquals(result.valid, true, "Should accept properly escaped tilde");
});

Deno.test("EDGE: $ref with slash not escaped", async () => {
  const schema: Schema = {
    $defs: {
      "User/Admin": { type: "string" }, // Slash in name (unusual)
    },
    properties: {
      user: { $ref: "#/$defs/User/Admin" }, // Ambiguous - could be nested
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // This is ambiguous - is it User/Admin or User > Admin?
  // Should fail to resolve (likely tries to find nested path)
  assertEquals(
    result.valid,
    false,
    "Should fail on ambiguous unescaped slash",
  );
});

Deno.test("EDGE: $ref with properly escaped slash", async () => {
  const schema: Schema = {
    $defs: {
      "User/Admin": { type: "string" }, // Slash in name
    },
    properties: {
      user: { $ref: "#/$defs/User~1Admin" }, // Properly escaped
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Properly escaped should work
  assertEquals(result.valid, true, "Should accept properly escaped slash");
  assertEquals(
    result.schema!.refs.resolved.has("#/$defs/User~1Admin"),
    true,
    "Should resolve ref with escaped slash",
  );
});

Deno.test("EDGE: $ref pointing to non-existent deep path", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p" }, // Very deep, doesn't exist
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should fail with clear error about missing path
  assertEquals(result.valid, false, "Should reject non-existent deep path");
});

Deno.test("EDGE: $ref with array index syntax", async () => {
  const schema: Schema = {
    $defs: [
      { type: "string" },
      { type: "number" },
    ],
    properties: {
      user: { $ref: "#/$defs/0" }, // Array index
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // $defs should be object, not array
  // But if it IS an array, numeric indices should work
  assertEquals(result.valid, true, "Should handle array $defs");
});

Deno.test("EDGE: $ref with negative array index", async () => {
  const schema: Schema = {
    properties: {
      user: { $ref: "#/$defs/-1" }, // Negative index
    },
    $defs: {
      "-1": { type: "string" }, // String key "-1"
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // "-1" as string key should work
  assertEquals(result.valid, true, "Should handle string key that looks like negative index");
});

Deno.test("EDGE: Multiple $refs in same schema", async () => {
  // Invalid - schema can't have multiple $ref properties
  // But malformed specs might try this
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
  const result = await processor.process(schema);

  // In JSON Schema 2020-12, sibling keywords to $ref are ignored
  assertEquals(result.valid, true, "Should process $ref with siblings");

  // Should warn about ignored keywords
  assertEquals(
    result.warnings.length > 0,
    true,
    "Should warn about sibling keywords to $ref",
  );
});
