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
import { SchemaValidator } from "../../../packages/json-schema/schema-validator.ts";
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
  assertExists(result.schema, "Should return processed schema");

  // Data validation test to verify impossibility is detected
  const validator = new SchemaValidator(result.schema);
  // Neither a string nor a number can satisfy both type requirements
  assertEquals(
    validator.validate("test").valid,
    false,
    "String should fail - cannot be both string and number",
  );
  assertEquals(
    validator.validate(42).valid,
    false,
    "Number should fail - cannot be both string and number",
  );
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
  assertExists(result.schema, "Should return processed schema");

  // Data validation test - no number can satisfy min >= 10 AND max <= 5
  const validator = new SchemaValidator(result.schema);
  assertEquals(
    validator.validate(7).valid,
    false,
    "7 should fail - cannot be >= 10 AND <= 5",
  );
  assertEquals(
    validator.validate(10).valid,
    false,
    "10 should fail - violates maximum: 5",
  );
  assertEquals(
    validator.validate(3).valid,
    false,
    "3 should fail - violates minimum: 10",
  );
});

Deno.test({
  name: "EDGE: Deeply nested allOf (100 levels)",

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
  // properties defined in allOf schemas.
  //
  // NOTE: This is actually CORRECT behavior per JSON Schema spec!
  // additionalProperties at root level only sees properties defined at root level,
  // NOT properties defined in allOf subschemas. This is why unevaluatedProperties
  // was added in later JSON Schema drafts.
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
  assertExists(result.schema, "Should return processed schema");

  // Data validation test - this is the CORE of the edge case
  const validator = new SchemaValidator(result.schema);

  // Per JSON Schema spec, additionalProperties: false at root only knows about
  // properties defined at root level. Properties in allOf are NOT visible to it.
  // This means ALL properties appear "additional" to the root schema.
  //
  // This is why unevaluatedProperties was introduced - it tracks which properties
  // were "evaluated" by any subschema.
  const dataWithAllOfProps = { a: "x", b: "y", c: "z" };
  const validation = validator.validate(dataWithAllOfProps);
  // Note: This REJECTS because additionalProperties doesn't see allOf properties
  // This is expected per spec, though many find it surprising
  assertEquals(
    validation.valid,
    false,
    "Strict JSON Schema: additionalProperties rejects allOf properties (use unevaluatedProperties instead)",
  );
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
  // Boolean schemas are valid in JSON Schema 2020-12 but our type doesn't include them
  const schema = {
    allOf: [
      true, // Allows anything
      { type: "object" },
    ],
  } as unknown as Schema;

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Boolean schemas in allOf should be handled
  assertEquals(result.valid, true, "Should handle boolean schemas in allOf");
});

Deno.test("EDGE: allOf with false schema (impossible)", async () => {
  // Boolean schemas are valid in JSON Schema 2020-12 but our type doesn't include them
  const schema = {
    allOf: [
      false, // Rejects everything
      { type: "object" },
    ],
  } as unknown as Schema;

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Schema is valid (but creates impossible constraint)
  assertEquals(
    result.valid,
    true,
    "Schema with false in allOf should be valid",
  );
  assertExists(result.schema, "Should return processed schema");

  // Data validation test - false in allOf rejects everything
  const validator = new SchemaValidator(result.schema);
  assertEquals(
    validator.validate({}).valid,
    false,
    "Empty object should fail - false rejects everything",
  );
  assertEquals(
    validator.validate("anything").valid,
    false,
    "Any value should fail - false rejects everything",
  );
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
  assertExists(result.schema, "Should return processed schema");

  // Data validation test - should require both a and c (union of required arrays)
  const validator = new SchemaValidator(result.schema);
  assertEquals(
    validator.validate({ a: "x" }).valid,
    false,
    "Missing 'c' should fail",
  );
  assertEquals(
    validator.validate({ c: "z" }).valid,
    false,
    "Missing 'a' should fail",
  );
  assertEquals(
    validator.validate({ a: "x", c: "z" }).valid,
    true,
    "Both 'a' and 'c' present should pass",
  );
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
