/**
 * Edge Case Tests: Incorrect allOf Usage
 *
 * Tests for recursive schemas with incorrect inlined allOf - patterns that
 * break many OpenAPI tools. These are REAL-WORLD edge cases from messy specs.
 *
 * USER REQUIREMENT: "Consider a widely recursive with incorrect inlined allOf,
 * variants, etc causing infinite loop in a lot of openapi tools."
 */

import { assertEquals, assertExists } from "@std/assert";
import { JsonSchemaProcessor } from "../../../packages/json-schema/processor.ts";
import type { Schema } from "../../../packages/json-schema/types.ts";

Deno.test("EDGE: allOf with circular self-reference", async () => {
  const schema: Schema = {
    allOf: [
      { $ref: "#/$defs/A" },
    ],
    $defs: {
      A: {
        allOf: [
          { $ref: "#" }, // Circular back to root
          { type: "object" },
        ],
      },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should detect cycle and not crash
  assertEquals(result.valid, true, "Should process without crashing");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.size > 0,
    true,
    "Should detect circular reference",
  );
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect cycle at root",
  );
});

Deno.test("EDGE: allOf with conflicting type requirements", async () => {
  const schema: Schema = {
    allOf: [
      { type: "string" },
      { type: "number" }, // Impossible to satisfy both
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // This schema is technically valid but creates an impossible constraint
  // Validation of data should fail, but schema processing should succeed
  assertEquals(result.valid, true, "Schema itself should be valid");

  // TODO: Add data validation test to verify impossibility is detected
  // const validator = new SchemaValidator(result.schema);
  // assertEquals(validator.validate("test").valid, false);
  // assertEquals(validator.validate(42).valid, false);
});

Deno.test("EDGE: allOf with conflicting numeric constraints", async () => {
  const schema: Schema = {
    type: "number",
    allOf: [
      { minimum: 10 },
      { maximum: 5 }, // Impossible: no number can be >= 10 AND <= 5
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Schema is valid, but creates impossible constraint
  assertEquals(result.valid, true, "Schema itself should be valid");

  // TODO: Add data validation test
  // const validator = new SchemaValidator(result.schema);
  // assertEquals(validator.validate(7).valid, false);
});

Deno.test({
  name: "EDGE: Deeply nested allOf (100 levels)",
  timeout: 10000, // 10 second timeout
  async fn() {
    // Create deeply nested allOf schema
    let schema: Schema = { type: "object" };
    for (let i = 0; i < 100; i++) {
      schema = {
        allOf: [schema, { type: "object" }],
      };
    }

    const processor = new JsonSchemaProcessor();
    const start = performance.now();
    const result = await processor.process(schema);
    const duration = performance.now() - start;

    // Should handle without stack overflow
    assertEquals(result.valid, true, "Should process deeply nested allOf");

    // Should complete in reasonable time (< 10 seconds)
    assertEquals(
      duration < 10000,
      true,
      `Should complete in < 10s (took ${duration.toFixed(2)}ms)`,
    );
  },
});

Deno.test("EDGE: allOf with circular refs through properties", async () => {
  const schema: Schema = {
    allOf: [
      { properties: { a: { $ref: "#/$defs/B" } } },
      { properties: { b: { $ref: "#/$defs/A" } } },
    ],
    $defs: {
      A: { allOf: [{ $ref: "#" }] },
      B: { allOf: [{ $ref: "#/$defs/A" }] },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should detect cycles
  assertEquals(result.valid, true, "Should process without crashing");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.size > 0,
    true,
    "Should detect circular references",
  );
});

Deno.test("EDGE: allOf with indirect circular reference", async () => {
  const schema: Schema = {
    $defs: {
      A: {
        allOf: [
          { $ref: "#/$defs/B" },
          { type: "object" },
        ],
      },
      B: {
        allOf: [
          { $ref: "#/$defs/C" },
          { type: "object" },
        ],
      },
      C: {
        allOf: [
          { $ref: "#/$defs/A" }, // Cycle: A -> B -> C -> A
          { type: "object" },
        ],
      },
    },
    $ref: "#/$defs/A",
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should detect three-way cycle
  assertEquals(result.valid, true, "Should process without crashing");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.size >= 3,
    true,
    "Should detect all three refs in cycle",
  );
  assertEquals(
    result.schema.refs.cyclic.has("#/$defs/A"),
    true,
    "Should detect A in cycle",
  );
  assertEquals(
    result.schema.refs.cyclic.has("#/$defs/B"),
    true,
    "Should detect B in cycle",
  );
  assertEquals(
    result.schema.refs.cyclic.has("#/$defs/C"),
    true,
    "Should detect C in cycle",
  );
});

Deno.test("EDGE: allOf with mixed composition and recursion", async () => {
  const schema: Schema = {
    allOf: [
      { $ref: "#/$defs/Base" },
      {
        oneOf: [
          { $ref: "#/$defs/TypeA" },
          { $ref: "#/$defs/TypeB" },
        ],
      },
    ],
    $defs: {
      Base: {
        type: "object",
        properties: {
          id: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#" }, // Recursive
          },
        },
      },
      TypeA: {
        properties: {
          typeA: { type: "boolean" },
        },
      },
      TypeB: {
        properties: {
          typeB: { type: "number" },
        },
      },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should handle complex composition with recursion
  assertEquals(result.valid, true, "Should process complex composition");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root recursion",
  );
});

Deno.test("EDGE: allOf with additionalProperties false across schemas", async () => {
  // This pattern is known to break many tools - they incorrectly reject
  // properties defined in allOf schemas
  const schema: Schema = {
    allOf: [
      {
        properties: {
          a: { type: "string" },
          b: { type: "string" },
        },
      },
      {
        properties: {
          c: { type: "string" },
        },
      },
    ],
    additionalProperties: false,
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Schema itself should be valid
  assertEquals(result.valid, true, "Schema should be valid");

  // TODO: Add data validation test - this is the CORE of the edge case
  // const validator = new SchemaValidator(result.schema);
  //
  // // SHOULD accept - properties defined in allOf
  // const validData = { a: "x", b: "y", c: "z" };
  // assertEquals(validator.validate(validData).valid, true,
  //   "Should accept properties from allOf");
  //
  // // SHOULD reject - truly additional property
  // const invalidData = { a: "x", b: "y", c: "z", d: "extra" };
  // assertEquals(validator.validate(invalidData).valid, false,
  //   "Should reject additional properties");
});

Deno.test("EDGE: allOf with empty schemas", async () => {
  const schema: Schema = {
    allOf: [
      {}, // Empty schema (allows anything)
      {}, // Empty schema (allows anything)
      { type: "object" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Empty schemas in allOf should be handled correctly
  assertEquals(result.valid, true, "Should handle empty schemas in allOf");
});

Deno.test("EDGE: allOf with boolean schemas", async () => {
  const schema: Schema = {
    allOf: [
      true, // Allows anything
      { type: "object" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Boolean schemas in allOf should be handled
  assertEquals(result.valid, true, "Should handle boolean schemas in allOf");
});

Deno.test("EDGE: allOf with false schema (impossible)", async () => {
  const schema: Schema = {
    allOf: [
      false, // Rejects everything
      { type: "object" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Schema is valid (but creates impossible constraint)
  assertEquals(
    result.valid,
    true,
    "Schema with false in allOf should be valid",
  );

  // TODO: Add data validation test
  // const validator = new SchemaValidator(result.schema);
  // assertEquals(validator.validate({}).valid, false);
});

Deno.test("EDGE: allOf with nested allOf", async () => {
  const schema: Schema = {
    allOf: [
      {
        allOf: [
          {
            allOf: [
              { type: "object" },
              { properties: { a: { type: "string" } } },
            ],
          },
          { properties: { b: { type: "number" } } },
        ],
      },
      { properties: { c: { type: "boolean" } } },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Nested allOf should be handled
  assertEquals(result.valid, true, "Should handle nested allOf");
});

Deno.test("EDGE: allOf with $ref that points to another allOf", async () => {
  const schema: Schema = {
    allOf: [
      { $ref: "#/$defs/AllOfDef" },
    ],
    $defs: {
      AllOfDef: {
        allOf: [
          { $ref: "#/$defs/Base" },
          { $ref: "#/$defs/Extension" },
        ],
      },
      Base: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      },
      Extension: {
        properties: {
          extra: { type: "boolean" },
        },
      },
    },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should handle reference chains through allOf
  assertEquals(result.valid, true, "Should handle allOf reference chains");
  assertExists(result.schema, "Should return processed schema");

  // Check that all expected refs are resolved (test behavior, not implementation details)
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/AllOfDef"),
    true,
    "Should resolve AllOfDef ref",
  );
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/Base"),
    true,
    "Should resolve Base ref",
  );
  assertEquals(
    result.schema.refs.resolved.has("#/$defs/Extension"),
    true,
    "Should resolve Extension ref",
  );
});

Deno.test("EDGE: allOf with circular dependency in properties", async () => {
  const schema: Schema = {
    allOf: [
      {
        properties: {
          parent: { $ref: "#" },
        },
      },
      {
        properties: {
          children: {
            type: "array",
            items: { $ref: "#" },
          },
        },
      },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should handle circular dependency in allOf properties
  assertEquals(result.valid, true, "Should handle circular allOf properties");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test("EDGE: allOf merging conflicting required arrays", async () => {
  const schema: Schema = {
    allOf: [
      {
        type: "object",
        properties: {
          a: { type: "string" },
          b: { type: "string" },
        },
        required: ["a"],
      },
      {
        properties: {
          c: { type: "string" },
        },
        required: ["c"],
      },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should merge required arrays correctly (union)
  assertEquals(
    result.valid,
    true,
    "Should handle merging required arrays in allOf",
  );

  // TODO: Add data validation test
  // const validator = new SchemaValidator(result.schema);
  // // Should require both a and c
  // assertEquals(validator.validate({ a: "x" }).valid, false);
  // assertEquals(validator.validate({ c: "z" }).valid, false);
  // assertEquals(validator.validate({ a: "x", c: "z" }).valid, true);
});

Deno.test("EDGE: allOf with unevaluatedProperties", async () => {
  const schema: Schema = {
    allOf: [
      {
        properties: {
          foo: { type: "string" },
        },
      },
    ],
    unevaluatedProperties: false,
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // unevaluatedProperties is a complex keyword
  assertEquals(
    result.valid,
    true,
    "Should handle allOf with unevaluatedProperties",
  );
});

Deno.test({
  name: "EDGE: Performance - allOf with many schemas",
  timeout: 10000, // 10 second timeout
  async fn() {
    // Create allOf with 100 schemas
    const schemas: Schema[] = [];
    for (let i = 0; i < 100; i++) {
      schemas.push({
        properties: {
          [`prop${i}`]: { type: "string" },
        },
      });
    }

    const schema: Schema = {
      allOf: schemas,
    };

    const processor = new JsonSchemaProcessor();
    const start = performance.now();
    const result = await processor.process(schema);
    const duration = performance.now() - start;

    // Should handle many allOf schemas efficiently
    assertEquals(result.valid, true, "Should handle many allOf schemas");
    assertEquals(
      duration < 5000,
      true,
      `Should complete in < 5s (took ${duration.toFixed(2)}ms)`,
    );
  },
});
