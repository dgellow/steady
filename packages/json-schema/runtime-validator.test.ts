/**
 * Runtime Validator Tests
 *
 * Tests for the RuntimeValidator class, focusing on:
 * - ReDoS protection behavior
 * - Regex validation edge cases
 * - Format validation
 * - Type validation
 */

import { assertEquals, assertExists } from "@std/assert";
import { JsonSchemaProcessor } from "./processor.ts";
import { RuntimeValidator } from "./runtime-validator.ts";

/**
 * Helper to create a RuntimeValidator from a raw schema
 */
async function createValidator(
  schema: unknown,
  options?: { validateFormats?: boolean },
): Promise<RuntimeValidator> {
  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema, {
    baseUri: "test://runtime-validator-test",
  });

  if (!result.valid || !result.schema) {
    throw new Error(
      `Failed to process schema: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return new RuntimeValidator(result.schema, options);
}

// =============================================================================
// ReDoS Protection Tests
// =============================================================================

Deno.test("safeRegexTest: invalid regex pattern should FAIL validation", async () => {
  // Schema with an invalid regex pattern (unbalanced parenthesis)
  const schema = {
    type: "string",
    pattern: "(((",  // Invalid regex - unbalanced parentheses
  };

  const validator = await createValidator(schema);

  // The string "hello" does NOT match pattern "(((" but the bug causes it to pass
  // because safeRegexTest catches the RegExp error and returns true
  const errors = validator.validate("hello");

  // EXPECTED: Should have an error because the pattern is invalid
  // The current buggy behavior returns no errors (silently passes)
  assertExists(errors, "Should return errors array");
  assertEquals(
    errors.length > 0,
    true,
    "Invalid regex pattern should cause validation to fail, not silently pass",
  );
});

Deno.test("safeRegexTest: extremely long string should FAIL pattern validation", async () => {
  const schema = {
    type: "string",
    pattern: "^[a-z]+$",  // Pattern that requires lowercase letters only
  };

  const validator = await createValidator(schema);

  // Create a string that's too long for safe regex testing (> 100000 chars)
  // but does NOT match the pattern (contains uppercase)
  const longInvalidString = "A".repeat(150_000);  // All uppercase, doesn't match pattern

  const errors = validator.validate(longInvalidString);

  // EXPECTED: Should fail because the string doesn't match the pattern
  // The current buggy behavior returns true (passes) for strings > 100000 chars
  assertExists(errors, "Should return errors array");
  assertEquals(
    errors.length > 0,
    true,
    "Long string that doesn't match pattern should fail validation, not silently pass",
  );
});

Deno.test("safeRegexTest: valid regex with matching string should pass", async () => {
  const schema = {
    type: "string",
    pattern: "^[a-z]+$",
  };

  const validator = await createValidator(schema);
  const errors = validator.validate("hello");

  assertEquals(errors.length, 0, "Valid string matching pattern should pass");
});

Deno.test("safeRegexTest: valid regex with non-matching string should fail", async () => {
  const schema = {
    type: "string",
    pattern: "^[a-z]+$",
  };

  const validator = await createValidator(schema);
  const errors = validator.validate("Hello123");

  assertEquals(
    errors.length > 0,
    true,
    "String not matching pattern should fail validation",
  );
  assertEquals(errors[0]?.keyword, "pattern");
});

// =============================================================================
// Type Validation Tests
// =============================================================================

Deno.test("type validation: string type rejects number", async () => {
  const schema = { type: "string" };
  const validator = await createValidator(schema);

  const errors = validator.validate(123);

  assertEquals(errors.length, 1);
  assertEquals(errors[0]?.keyword, "type");
});

Deno.test("type validation: integer accepts integer", async () => {
  const schema = { type: "integer" };
  const validator = await createValidator(schema);

  const errors = validator.validate(42);

  assertEquals(errors.length, 0);
});

Deno.test("type validation: integer rejects float", async () => {
  const schema = { type: "integer" };
  const validator = await createValidator(schema);

  const errors = validator.validate(42.5);

  assertEquals(errors.length, 1);
  assertEquals(errors[0]?.keyword, "type");
});

Deno.test("type validation: number accepts integer", async () => {
  const schema = { type: "number" };
  const validator = await createValidator(schema);

  const errors = validator.validate(42);

  assertEquals(errors.length, 0, "integer should be accepted as number");
});

Deno.test("type validation: null type accepts null", async () => {
  const schema = { type: "null" };
  const validator = await createValidator(schema);

  const errors = validator.validate(null);

  assertEquals(errors.length, 0);
});

Deno.test("type validation: array of types works", async () => {
  const schema = { type: ["string", "number"] };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("hello").length, 0);
  assertEquals(validator.validate(42).length, 0);
  assertEquals(validator.validate(true).length, 1);
});

// =============================================================================
// String Validation Tests
// =============================================================================

Deno.test("string validation: minLength", async () => {
  const schema = { type: "string", minLength: 5 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("hello").length, 0);
  assertEquals(validator.validate("hi").length, 1);
  assertEquals(validator.validate("hi")[0]?.keyword, "minLength");
});

Deno.test("string validation: maxLength", async () => {
  const schema = { type: "string", maxLength: 5 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("hello").length, 0);
  assertEquals(validator.validate("hello world").length, 1);
  assertEquals(validator.validate("hello world")[0]?.keyword, "maxLength");
});

// =============================================================================
// Number Validation Tests
// =============================================================================

Deno.test("number validation: minimum", async () => {
  const schema = { type: "number", minimum: 0 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate(0).length, 0);
  assertEquals(validator.validate(1).length, 0);
  assertEquals(validator.validate(-1).length, 1);
  assertEquals(validator.validate(-1)[0]?.keyword, "minimum");
});

Deno.test("number validation: exclusiveMinimum", async () => {
  const schema = { type: "number", exclusiveMinimum: 0 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate(1).length, 0);
  assertEquals(validator.validate(0).length, 1);
  assertEquals(validator.validate(0)[0]?.keyword, "exclusiveMinimum");
});

Deno.test("number validation: multipleOf", async () => {
  const schema = { type: "number", multipleOf: 2 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate(4).length, 0);
  assertEquals(validator.validate(3).length, 1);
  assertEquals(validator.validate(3)[0]?.keyword, "multipleOf");
});

// =============================================================================
// Array Validation Tests
// =============================================================================

Deno.test("array validation: minItems", async () => {
  const schema = { type: "array", minItems: 2 };
  const validator = await createValidator(schema);

  assertEquals(validator.validate([1, 2]).length, 0);
  assertEquals(validator.validate([1]).length, 1);
});

Deno.test("array validation: uniqueItems", async () => {
  const schema = { type: "array", uniqueItems: true };
  const validator = await createValidator(schema);

  assertEquals(validator.validate([1, 2, 3]).length, 0);
  assertEquals(validator.validate([1, 2, 1]).length, 1);
  assertEquals(validator.validate([1, 2, 1])[0]?.keyword, "uniqueItems");
});

Deno.test("array validation: uniqueItems with objects uses canonical JSON", async () => {
  const schema = { type: "array", uniqueItems: true };
  const validator = await createValidator(schema);

  // Same object with different key order should be considered equal
  assertEquals(
    validator.validate([{ a: 1, b: 2 }, { b: 2, a: 1 }]).length,
    1,
    "Objects with same content but different key order should be duplicates",
  );
});

// =============================================================================
// Object Validation Tests
// =============================================================================

Deno.test("object validation: required", async () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
    },
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate({ name: "Alice" }).length, 0);
  assertEquals(validator.validate({}).length, 1);
  assertEquals(validator.validate({})[0]?.keyword, "required");
});

Deno.test("object validation: additionalProperties false", async () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" } },
    additionalProperties: false,
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate({ name: "Alice" }).length, 0);
  assertEquals(validator.validate({ name: "Alice", extra: "value" }).length, 1);
  assertEquals(
    validator.validate({ name: "Alice", extra: "value" })[0]?.keyword,
    "additionalProperties",
  );
});

// =============================================================================
// Composition Validation Tests
// =============================================================================

Deno.test("composition: allOf", async () => {
  const schema = {
    allOf: [
      { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
    ],
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate({ a: "hello", b: 42 }).length, 0);
  assertEquals(validator.validate({ a: "hello" }).length, 1);  // missing b
  assertEquals(validator.validate({ b: 42 }).length, 1);  // missing a
});

Deno.test("composition: anyOf", async () => {
  const schema = {
    anyOf: [
      { type: "string" },
      { type: "number" },
    ],
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("hello").length, 0);
  assertEquals(validator.validate(42).length, 0);
  assertEquals(validator.validate(true).length, 1);
  assertEquals(validator.validate(true)[0]?.keyword, "anyOf");
});

Deno.test("composition: oneOf", async () => {
  const schema = {
    oneOf: [
      { type: "integer", multipleOf: 2 },  // even integers
      { type: "integer", multipleOf: 3 },  // multiples of 3
    ],
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate(2).length, 0);  // matches only first
  assertEquals(validator.validate(3).length, 0);  // matches only second
  assertEquals(validator.validate(6).length, 1);  // matches both - error!
  assertEquals(validator.validate(5).length, 1);  // matches neither - error!
});

Deno.test("composition: not", async () => {
  const schema = {
    not: { type: "string" },
  };
  const validator = await createValidator(schema);

  assertEquals(validator.validate(42).length, 0);
  assertEquals(validator.validate("hello").length, 1);
  assertEquals(validator.validate("hello")[0]?.keyword, "not");
});

// =============================================================================
// Format Validation Tests (when enabled)
// =============================================================================

Deno.test("format validation: email (when enabled)", async () => {
  const schema = { type: "string", format: "email" };
  const validator = await createValidator(schema, { validateFormats: true });

  assertEquals(validator.validate("test@example.com").length, 0);
  assertEquals(validator.validate("not-an-email").length, 1);
});

Deno.test("format validation: uri (when enabled)", async () => {
  const schema = { type: "string", format: "uri" };
  const validator = await createValidator(schema, { validateFormats: true });

  assertEquals(validator.validate("https://example.com").length, 0);
  assertEquals(validator.validate("not a uri").length, 1);
});

Deno.test("format validation: uuid (when enabled)", async () => {
  const schema = { type: "string", format: "uuid" };
  const validator = await createValidator(schema, { validateFormats: true });

  assertEquals(
    validator.validate("550e8400-e29b-41d4-a716-446655440000").length,
    0,
  );
  assertEquals(validator.validate("not-a-uuid").length, 1);
});

Deno.test("format validation: disabled by default", async () => {
  const schema = { type: "string", format: "email" };
  const validator = await createValidator(schema);  // validateFormats not set

  // Should pass because format validation is disabled by default
  assertEquals(validator.validate("not-an-email").length, 0);
});

// =============================================================================
// Const and Enum Tests
// =============================================================================

Deno.test("const validation", async () => {
  const schema = { const: "exact" };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("exact").length, 0);
  assertEquals(validator.validate("different").length, 1);
  assertEquals(validator.validate("different")[0]?.keyword, "const");
});

Deno.test("enum validation", async () => {
  const schema = { enum: ["red", "green", "blue"] };
  const validator = await createValidator(schema);

  assertEquals(validator.validate("red").length, 0);
  assertEquals(validator.validate("yellow").length, 1);
  assertEquals(validator.validate("yellow")[0]?.keyword, "enum");
});

// =============================================================================
// Boolean Schema Tests
// =============================================================================

Deno.test("boolean schema: true accepts everything", async () => {
  const schema = true;
  const validator = await createValidator(schema);

  assertEquals(validator.validate(null).length, 0);
  assertEquals(validator.validate("string").length, 0);
  assertEquals(validator.validate(123).length, 0);
  assertEquals(validator.validate({}).length, 0);
  assertEquals(validator.validate([]).length, 0);
});

Deno.test("boolean schema: false rejects everything", async () => {
  const schema = false;
  const validator = await createValidator(schema);

  assertEquals(validator.validate(null).length, 1);
  assertEquals(validator.validate("string").length, 1);
  assertEquals(validator.validate(123).length, 1);
  assertEquals(validator.validate(null)[0]?.keyword, "false");
});

// =============================================================================
// Conditional Validation Tests (if/then/else)
// =============================================================================

Deno.test("conditional: if/then/else", async () => {
  const schema = {
    type: "object",
    if: {
      properties: { type: { const: "business" } },
      required: ["type"],
    },
    then: {
      required: ["businessId"],
    },
    else: {
      required: ["personalId"],
    },
  };
  const validator = await createValidator(schema);

  // Business type requires businessId
  assertEquals(
    validator.validate({ type: "business", businessId: "123" }).length,
    0,
  );
  assertEquals(
    validator.validate({ type: "business" }).length,
    1,  // missing businessId
  );

  // Personal type requires personalId
  assertEquals(
    validator.validate({ type: "personal", personalId: "456" }).length,
    0,
  );
  assertEquals(
    validator.validate({ type: "personal" }).length,
    1,  // missing personalId
  );
});
