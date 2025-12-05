/**
 * Tests for Response Generator (RegistryResponseGenerator)
 */

import { assertEquals } from "@std/assert";
import {
  RegistryResponseGenerator,
  SchemaRegistry,
} from "./schema-registry.ts";
import type { Schema } from "./types.ts";

/**
 * Helper to create a SchemaRegistry from a root schema for testing
 */
function createRegistry(schema: Schema): SchemaRegistry {
  // Wrap the schema in a document structure that SchemaRegistry expects
  const document = { schema };
  return new SchemaRegistry(document);
}

Deno.test("RegistryResponseGenerator - generates string for simple string schema", () => {
  const schema: Schema = { type: "string" };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0);

  assertEquals(typeof result, "string");
});

Deno.test("RegistryResponseGenerator - generates number for integer schema", () => {
  const schema: Schema = { type: "integer", minimum: 0, maximum: 100 };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0);

  assertEquals(typeof result, "number");
  assertEquals(Number.isInteger(result), true);
});

Deno.test("RegistryResponseGenerator - uses example when provided", () => {
  const schema: Schema = { type: "string", example: "hello world" };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0);

  assertEquals(result, "hello world");
});

Deno.test("RegistryResponseGenerator - anyOf with string or null should generate string or null, not empty object", () => {
  // This is the exact schema pattern causing the Anthropic SDK failures
  const schema: Schema = {
    anyOf: [{ type: "string" }, { type: "null" }],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0);

  // Result should be either a string or null, NOT an empty object
  const isStringOrNull = typeof result === "string" || result === null;
  assertEquals(
    isStringOrNull,
    true,
    `Expected string or null, got: ${
      JSON.stringify(result)
    } (type: ${typeof result})`,
  );
});

Deno.test("RegistryResponseGenerator - oneOf should pick first matching schema", () => {
  const schema: Schema = {
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "number" },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0);

  // Should pick the first option (string)
  assertEquals(typeof result, "string");
});

Deno.test("RegistryResponseGenerator - allOf should merge schemas", () => {
  const schema: Schema = {
    allOf: [
      {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      { properties: { age: { type: "integer" } }, required: ["age"] },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0) as Record<
    string,
    unknown
  >;

  // Should have both name and age
  assertEquals(typeof result, "object");
  assertEquals("name" in result, true);
  assertEquals("age" in result, true);
});

Deno.test("RegistryResponseGenerator - nested anyOf in object property", () => {
  // Real-world pattern from Anthropic API
  const schema: Schema = {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      first_id: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      last_id: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      has_more: { type: "boolean" },
    },
    required: ["data", "has_more"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#", 0) as Record<
    string,
    unknown
  >;

  assertEquals(typeof result, "object");
  assertEquals(Array.isArray(result.data), true);
  assertEquals(typeof result.has_more, "boolean");

  // first_id and last_id should be string or null, not {}
  if ("first_id" in result) {
    const isValid = typeof result.first_id === "string" ||
      result.first_id === null;
    assertEquals(
      isValid,
      true,
      `first_id should be string or null, got: ${
        JSON.stringify(result.first_id)
      }`,
    );
  }
  if ("last_id" in result) {
    const isValid = typeof result.last_id === "string" ||
      result.last_id === null;
    assertEquals(
      isValid,
      true,
      `last_id should be string or null, got: ${
        JSON.stringify(result.last_id)
      }`,
    );
  }
});

Deno.test("RegistryResponseGenerator - allOf with $ref resolves referenced schema properties", () => {
  // This is the Lithic SDK failure pattern: allOf with $ref to base schema
  // The bug: $ref schemas have no direct .properties, so they get skipped
  const document = {
    components: {
      schemas: {
        BaseTransaction: {
          type: "object",
          properties: {
            token: { type: "string" },
            status: { type: "string" },
            created: { type: "string", format: "date-time" },
          },
          required: ["token", "status", "created"],
        },
        FinancialTransaction: {
          allOf: [
            { $ref: "#/components/schemas/BaseTransaction" },
            {
              type: "object",
              properties: {
                family: { type: "string" },
                category: { type: "string" },
              },
              required: ["family"],
            },
          ],
        },
      },
    },
  };

  const registry = new SchemaRegistry(document);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generate(
    "#/components/schemas/FinancialTransaction",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object", "Result should be an object");

  // Properties from the $ref'd BaseTransaction should be included
  assertEquals(
    "token" in result,
    true,
    `Should include 'token' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "status" in result,
    true,
    `Should include 'status' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "created" in result,
    true,
    `Should include 'created' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );

  // Properties from the inline schema should also be included
  assertEquals(
    "family" in result,
    true,
    `Should include 'family' from inline schema, got: ${
      JSON.stringify(result)
    }`,
  );
});
