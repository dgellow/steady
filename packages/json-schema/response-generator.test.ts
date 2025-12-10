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

Deno.test("RegistryResponseGenerator - seeded RNG produces deterministic output per generate() call", () => {
  const document = {
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "integer", minimum: 1, maximum: 1000000 },
            name: { type: "string", minLength: 5, maxLength: 20 },
            email: { type: "string", format: "email" },
          },
          required: ["id", "name", "email"],
        },
      },
    },
  };

  const registry = new SchemaRegistry(document);

  // Create generator with fixed seed
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  // Generate multiple times - each call should produce the same result
  const result1 = generator.generate("#/components/schemas/User");
  const result2 = generator.generate("#/components/schemas/User");
  const result3 = generator.generate("#/components/schemas/User");

  assertEquals(
    JSON.stringify(result1),
    JSON.stringify(result2),
    "Same seed should produce identical results on repeated generate() calls",
  );
  assertEquals(
    JSON.stringify(result2),
    JSON.stringify(result3),
    "Same seed should produce identical results on repeated generate() calls",
  );
});

Deno.test("RegistryResponseGenerator - different seeds produce different output", () => {
  const document = {
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "integer", minimum: 1, maximum: 1000000 },
            name: { type: "string", minLength: 10, maxLength: 20 },
          },
          required: ["id", "name"],
        },
      },
    },
  };

  const registry = new SchemaRegistry(document);

  const generator1 = new RegistryResponseGenerator(registry, { seed: 42 });
  const generator2 = new RegistryResponseGenerator(registry, { seed: 12345 });

  const result1 = generator1.generate("#/components/schemas/User");
  const result2 = generator2.generate("#/components/schemas/User");

  // Different seeds should (almost certainly) produce different results
  // for schemas with randomness
  assertEquals(
    JSON.stringify(result1) !== JSON.stringify(result2),
    true,
    "Different seeds should produce different results",
  );
});

Deno.test("SchemaRegistry - $id lookup requires exact match", () => {
  // Per JSON Schema spec, $ref values are resolved as URI-references.
  // Only exact $id matches should work - no basename/suffix matching.
  const document = {
    $defs: {
      ExactUser: {
        $id: "User",
        type: "object",
        properties: { source: { type: "string", const: "exact" } },
      },
    },
    components: {
      schemas: {
        Profile: {
          type: "object",
          properties: {
            user: { $ref: "User" },
          },
        },
      },
    },
  };

  const registry = new SchemaRegistry(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/Profile",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object");
  if (result.user && typeof result.user === "object") {
    const user = result.user as Record<string, unknown>;
    assertEquals(
      user.source,
      "exact",
      "$ref 'User' should resolve to schema with $id 'User'",
    );
  }
});

Deno.test("SchemaRegistry - $id lookup does not do basename matching", () => {
  // Per JSON Schema spec, $ref: "User" should NOT match $id: "https://example.com/User"
  // This is non-standard behavior that we explicitly don't support.
  const document = {
    $defs: {
      UserSchema: {
        $id: "https://example.com/schemas/User",
        type: "object",
        properties: { name: { type: "string", const: "should-not-resolve" } },
      },
    },
    components: {
      schemas: {
        Profile: {
          type: "object",
          properties: {
            // This should NOT resolve - "User" != "https://example.com/schemas/User"
            user: { $ref: "User" },
          },
        },
      },
    },
  };

  const registry = new SchemaRegistry(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/Profile",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object");
  // user should NOT have resolved to UserSchema (no basename matching)
  if (result.user && typeof result.user === "object") {
    const user = result.user as Record<string, unknown>;
    assertEquals(
      user.name !== "should-not-resolve",
      true,
      "$ref 'User' should NOT resolve to schema with $id 'https://example.com/schemas/User'",
    );
  }
});
