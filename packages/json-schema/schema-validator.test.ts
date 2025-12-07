/**
 * Schema Validator Tests
 *
 * Tests for the SchemaValidator class, which wraps RuntimeValidator
 * and adds error attribution analysis.
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { JsonSchemaProcessor } from "./processor.ts";
import { SchemaValidator } from "./schema-validator.ts";
import type { ProcessedSchema, Schema } from "./types.ts";

/**
 * Helper to create a SchemaValidator from a raw schema
 */
async function createValidator(
  schema: Schema,
): Promise<SchemaValidator> {
  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema, {
    baseUri: "test://schema-validator-test",
  });

  if (!result.valid || !result.schema) {
    throw new Error(
      `Failed to process schema: ${
        result.errors.map((e) => e.message).join(", ")
      }`,
    );
  }

  return new SchemaValidator(result.schema);
}

/**
 * Helper to get processed schema for direct validator construction
 */
async function getProcessedSchema(schema: Schema): Promise<ProcessedSchema> {
  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema, {
    baseUri: "test://schema-validator-test",
  });

  if (!result.valid || !result.schema) {
    throw new Error(
      `Failed to process schema: ${
        result.errors.map((e) => e.message).join(", ")
      }`,
    );
  }

  return result.schema;
}

// =============================================================================
// Basic Validation Tests
// =============================================================================

Deno.test("SchemaValidator: validates string type correctly", async () => {
  const validator = await createValidator({ type: "string" });

  const validResult = validator.validate("hello");
  assertEquals(validResult.valid, true, "String should pass string type check");
  assertEquals(validResult.errors.length, 0, "No errors for valid string");

  const invalidResult = validator.validate(42);
  assertEquals(
    invalidResult.valid,
    false,
    "Number should fail string type check",
  );
  assertEquals(invalidResult.errors.length > 0, true, "Should have errors");
});

Deno.test("SchemaValidator: validates number type correctly", async () => {
  const validator = await createValidator({ type: "number" });

  const validResult = validator.validate(42);
  assertEquals(validResult.valid, true, "Number should pass number type check");

  const invalidResult = validator.validate("not a number");
  assertEquals(
    invalidResult.valid,
    false,
    "String should fail number type check",
  );
});

Deno.test("SchemaValidator: validates object properties correctly", async () => {
  const validator = await createValidator({
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name"],
  });

  // Valid object with required property
  const validResult = validator.validate({ name: "John", age: 30 });
  assertEquals(validResult.valid, true, "Valid object should pass");

  // Missing required property
  const missingRequired = validator.validate({ age: 30 });
  assertEquals(
    missingRequired.valid,
    false,
    "Missing required property should fail",
  );

  // Wrong property type
  const wrongType = validator.validate({ name: "John", age: "thirty" });
  assertEquals(wrongType.valid, false, "Wrong property type should fail");
});

Deno.test("SchemaValidator: validates array items correctly", async () => {
  const validator = await createValidator({
    type: "array",
    items: { type: "number" },
  });

  const validResult = validator.validate([1, 2, 3]);
  assertEquals(validResult.valid, true, "Array of numbers should pass");

  const invalidResult = validator.validate([1, "two", 3]);
  assertEquals(invalidResult.valid, false, "Array with string should fail");
});

// =============================================================================
// Error Attribution Tests
// =============================================================================

Deno.test("SchemaValidator: includes error attribution on failures", async () => {
  // Test with type mismatch rather than format validation
  // (format validation is disabled by default)
  const validator = await createValidator({
    type: "object",
    properties: {
      count: { type: "number" },
    },
    required: ["count"],
  });

  const result = validator.validate({ count: "not-a-number" });
  assertEquals(result.valid, false, "String for number should fail");
  assertEquals(result.errors.length > 0, true, "Should have errors");

  // Check that attribution is attached to errors
  const error = result.errors[0];
  assertExists(error, "Should have at least one error");
  assertExists(error.attribution, "Error should have attribution");
  assertExists(error.attribution.type, "Attribution should have type");
  assertExists(
    error.attribution.confidence,
    "Attribution should have confidence",
  );
});

Deno.test("SchemaValidator: no attribution on valid data", async () => {
  const validator = await createValidator({ type: "string" });

  const result = validator.validate("valid string");
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.attribution, undefined, "No attribution for valid data");
});

// =============================================================================
// getProcessedSchema Tests
// =============================================================================

Deno.test("SchemaValidator: getProcessedSchema returns the processed schema", async () => {
  const processedSchema = await getProcessedSchema({
    type: "object",
    properties: {
      id: { type: "string" },
    },
  });

  const validator = new SchemaValidator(processedSchema);
  const returned = validator.getProcessedSchema();

  assertEquals(
    returned,
    processedSchema,
    "Should return the same processed schema",
  );
  assertExists(returned.refs, "Processed schema should have refs");
});

// =============================================================================
// validateFirst Tests
// =============================================================================

Deno.test("SchemaValidator: validateFirst returns first error only", async () => {
  const validator = await createValidator({
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "number" },
    },
    required: ["a", "b"],
  });

  // Both properties missing - should return only first error
  const error = validator.validateFirst({});
  assertExists(error, "Should return an error");
  assertEquals(typeof error.message, "string", "Error should have message");
});

Deno.test("SchemaValidator: validateFirst returns null for valid data", async () => {
  const validator = await createValidator({ type: "string" });

  const error = validator.validateFirst("valid");
  assertEquals(error, null, "Should return null for valid data");
});

// =============================================================================
// validateOrThrow Tests
// =============================================================================

Deno.test("SchemaValidator: validateOrThrow succeeds for valid data", async () => {
  const validator = await createValidator({ type: "number" });

  // Should not throw
  validator.validateOrThrow(42);
});

Deno.test("SchemaValidator: validateOrThrow throws for invalid data", async () => {
  const validator = await createValidator({ type: "number" });

  assertThrows(
    () => validator.validateOrThrow("not a number"),
    Error,
    "Validation failed",
  );
});

Deno.test("SchemaValidator: validateOrThrow error includes validation result", async () => {
  const validator = await createValidator({ type: "string" });

  try {
    validator.validateOrThrow(123);
    throw new Error("Should have thrown");
  } catch (e) {
    const error = e as Error & { validationResult?: unknown };
    assertExists(
      error.validationResult,
      "Error should include validationResult",
    );
    assertEquals(
      (error.validationResult as { valid: boolean }).valid,
      false,
      "Validation result should be invalid",
    );
  }
});

// =============================================================================
// Complex Schema Tests
// =============================================================================

Deno.test("SchemaValidator: handles nested objects correctly", async () => {
  const validator = await createValidator({
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
        },
        required: ["name"],
      },
    },
    required: ["user"],
  });

  const validResult = validator.validate({
    user: { name: "John", email: "john@example.com" },
  });
  assertEquals(validResult.valid, true);

  const invalidResult = validator.validate({
    user: { email: "john@example.com" },
  });
  assertEquals(
    invalidResult.valid,
    false,
    "Missing nested required property should fail",
  );
});

Deno.test("SchemaValidator: handles enum correctly", async () => {
  const validator = await createValidator({
    type: "string",
    enum: ["red", "green", "blue"],
  });

  assertEquals(validator.validate("red").valid, true);
  assertEquals(validator.validate("yellow").valid, false);
});

Deno.test("SchemaValidator: handles oneOf correctly", async () => {
  const validator = await createValidator({
    oneOf: [
      { type: "string" },
      { type: "number" },
    ],
  });

  assertEquals(validator.validate("hello").valid, true);
  assertEquals(validator.validate(42).valid, true);
  assertEquals(validator.validate([1, 2, 3]).valid, false);
});

Deno.test("SchemaValidator: handles additionalProperties false", async () => {
  const validator = await createValidator({
    type: "object",
    properties: {
      allowed: { type: "string" },
    },
    additionalProperties: false,
  });

  assertEquals(validator.validate({ allowed: "yes" }).valid, true);
  assertEquals(
    validator.validate({ allowed: "yes", extra: "no" }).valid,
    false,
    "Extra property should fail with additionalProperties: false",
  );
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("SchemaValidator: handles null value correctly", async () => {
  const validator = await createValidator({ type: "null" });

  assertEquals(validator.validate(null).valid, true);
  assertEquals(validator.validate(undefined).valid, false);
  assertEquals(validator.validate("null").valid, false);
});

Deno.test("SchemaValidator: handles boolean correctly", async () => {
  const validator = await createValidator({ type: "boolean" });

  assertEquals(validator.validate(true).valid, true);
  assertEquals(validator.validate(false).valid, true);
  assertEquals(validator.validate("true").valid, false);
  assertEquals(validator.validate(1).valid, false);
});

Deno.test("SchemaValidator: handles empty schema (allows anything)", async () => {
  const validator = await createValidator({});

  assertEquals(validator.validate("string").valid, true);
  assertEquals(validator.validate(42).valid, true);
  assertEquals(validator.validate(null).valid, true);
  assertEquals(validator.validate({}).valid, true);
  assertEquals(validator.validate([]).valid, true);
});

Deno.test("SchemaValidator: handles const correctly", async () => {
  const validator = await createValidator({
    const: "exact-value",
  });

  assertEquals(validator.validate("exact-value").valid, true);
  assertEquals(validator.validate("other-value").valid, false);
});
