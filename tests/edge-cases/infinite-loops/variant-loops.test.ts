/**
 * Edge Case Tests: Variant-Based Infinite Loops
 *
 * Tests for schema variants (oneOf/anyOf) that cause infinite loops in
 * many OpenAPI tools. These patterns must be handled WITHOUT infinite expansion.
 *
 * USER REQUIREMENT: "variants, etc causing infinite loop in a lot of openapi tools"
 */

import { assertEquals, assertExists } from "@std/assert";
import { JsonSchemaProcessor } from "../../../packages/json-schema/processor.ts";
import { ResponseGenerator } from "../../../packages/json-schema/response-generator.ts";
import type { Schema } from "../../../packages/json-schema/types.ts";

Deno.test({
  name: "EDGE: oneOf with recursive array items",
  
  async fn() {
    // This pattern causes infinite expansion in many tools
    const schema: Schema = {
      oneOf: [
        { type: "string" },
        { type: "array", items: { $ref: "#" } }, // Infinite expansion
      ],
    };

    const processor = new JsonSchemaProcessor();
    const result = await processor.process(schema);

    // Should detect cycle
    assertEquals(result.valid, true, "Should process without crashing");
    assertExists(result.schema, "Should return processed schema");
    assertEquals(
      result.schema.refs.cyclic.has("#"),
      true,
      "Should detect root cycle",
    );

    // Should generate response without infinite loop (with timeout protection)
    const generator = new ResponseGenerator(result.schema);
    const response = generator.generate();

    // Generated response should be finite
    const responseStr = JSON.stringify(response);
    assertEquals(
      responseStr.length < 100000,
      true,
      `Response should be finite (got ${responseStr.length} chars)`,
    );
  },
});

Deno.test("EDGE: anyOf with mutual recursion", async () => {
  // A and B recursively reference each other through anyOf
  const schema: Schema = {
    $defs: {
      A: {
        anyOf: [
          { $ref: "#/$defs/B" },
          { type: "string" },
        ],
      },
      B: {
        anyOf: [
          { $ref: "#/$defs/A" },
          { type: "number" },
        ],
      },
    },
    $ref: "#/$defs/A",
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should detect cycle between A and B
  assertEquals(result.valid, true, "Should process mutual recursion");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.size >= 2,
    true,
    "Should detect both refs in cycle",
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
});

Deno.test("EDGE: Complex variant nesting with recursion", async () => {
  // Deeply nested variants with recursion - breaks many tools
  const schema: Schema = {
    oneOf: [
      { allOf: [{ anyOf: [{ oneOf: [{ $ref: "#" }] }] }] },
      { type: "string" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should handle complex nesting
  assertEquals(result.valid, true, "Should process complex variant nesting");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test({
  name: "EDGE: anyOf with multiple recursive branches",
  
  async fn() {
    const schema: Schema = {
      type: "object",
      properties: {
        value: {
          anyOf: [
            { type: "string" },
            { type: "array", items: { $ref: "#" } },
            { type: "object", additionalProperties: { $ref: "#" } },
          ],
        },
      },
    };

    const processor = new JsonSchemaProcessor();
    const result = await processor.process(schema);

    // Should handle multiple recursive branches
    assertEquals(
      result.valid,
      true,
      "Should process multiple recursive branches",
    );
    assertExists(result.schema, "Should return processed schema");
    assertEquals(
      result.schema.refs.cyclic.has("#"),
      true,
      "Should detect root cycle",
    );

    // Response generation should not loop infinitely
    const generator = new ResponseGenerator(result.schema);
    const response = generator.generate();
    const responseStr = JSON.stringify(response);

    assertEquals(
      responseStr.length < 100000,
      true,
      "Response should be finite with multiple branches",
    );
  },
});

Deno.test("EDGE: oneOf with discriminator and recursion", async () => {
  // This pattern breaks Stoplight Prism
  const schema: Schema = {
    discriminator: { propertyName: "type" },
    oneOf: [
      {
        properties: {
          type: { const: "folder" },
          children: {
            type: "array",
            items: { $ref: "#" },
          },
        },
        required: ["type"],
      },
      {
        properties: {
          type: { const: "file" },
          content: { type: "string" },
        },
        required: ["type"],
      },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Should handle discriminator with recursion
  assertEquals(
    result.valid,
    true,
    "Should process discriminator with recursion",
  );
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test("EDGE: anyOf with circular chain through properties", async () => {
  const schema: Schema = {
    anyOf: [
      {
        properties: {
          next: { $ref: "#" },
        },
      },
      { type: "null" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Linked list pattern - common and should work
  assertEquals(result.valid, true, "Should process linked list pattern");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test("EDGE: oneOf with all branches recursive", async () => {
  const schema: Schema = {
    oneOf: [
      { type: "array", items: { $ref: "#" } },
      { type: "object", additionalProperties: { $ref: "#" } },
      { properties: { child: { $ref: "#" } } },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // All branches recursive - should still work
  assertEquals(result.valid, true, "Should process all-recursive oneOf");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test({
  name: "EDGE: Performance - oneOf with many recursive variants",
  
  async fn() {
    // Create oneOf with 50 recursive variants
    const variants: Schema[] = [];
    for (let i = 0; i < 50; i++) {
      variants.push({
        properties: {
          [`variant${i}`]: { $ref: "#" },
        },
      });
    }

    const schema: Schema = {
      oneOf: variants,
    };

    const processor = new JsonSchemaProcessor();
    const start = performance.now();
    const result = await processor.process(schema);
    const duration = performance.now() - start;

    // Should handle many variants efficiently
    assertEquals(result.valid, true, "Should process many recursive variants");
    assertEquals(
      duration < 5000,
      true,
      `Should complete in < 5s (took ${duration.toFixed(2)}ms)`,
    );
  },
});

Deno.test("EDGE: anyOf with nested oneOf recursion", async () => {
  const schema: Schema = {
    anyOf: [
      {
        oneOf: [
          { $ref: "#" },
          { type: "string" },
        ],
      },
      { type: "number" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Nested variants with recursion
  assertEquals(result.valid, true, "Should process nested variant recursion");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test("EDGE: Triple nested variants with recursion", async () => {
  // anyOf > oneOf > allOf > recursion
  // This pattern is known to break many tools
  const schema: Schema = {
    anyOf: [
      {
        oneOf: [
          {
            allOf: [
              { $ref: "#" },
              { type: "object" },
            ],
          },
          { type: "string" },
        ],
      },
      { type: "number" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Triple nesting with recursion
  assertEquals(result.valid, true, "Should process triple nested variants");
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test("EDGE: anyOf with if/then/else and recursion", async () => {
  const schema: Schema = {
    anyOf: [
      {
        if: {
          properties: { type: { const: "recursive" } },
        },
        then: {
          properties: { child: { $ref: "#" } },
        },
        else: {
          properties: { value: { type: "string" } },
        },
      },
      { type: "null" },
    ],
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Conditionals with variants and recursion
  assertEquals(
    result.valid,
    true,
    "Should process variants with conditionals",
  );
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test({
  name: "EDGE: Response generation does not loop infinitely",
  
  async fn() {
    const schema: Schema = {
      oneOf: [
        { type: "string" },
        {
          type: "array",
          items: { $ref: "#" },
          minItems: 0,
          maxItems: 3,
        },
      ],
    };

    const processor = new JsonSchemaProcessor();
    const result = await processor.process(schema);
    assertEquals(result.valid, true);
    assertExists(result.schema, "Should return processed schema");

    // Generate response 10 times - should never hang
    const generator = new ResponseGenerator(result.schema);

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const response = generator.generate();
      const duration = performance.now() - start;

      // Each generation should complete quickly
      assertEquals(
        duration < 1000,
        true,
        `Generation ${i} should complete in < 1s (took ${
          duration.toFixed(2)
        }ms)`,
      );

      // Response should be finite
      const responseStr = JSON.stringify(response);
      assertEquals(
        responseStr.length < 50000,
        true,
        `Response ${i} should be finite (got ${responseStr.length} chars)`,
      );
    }
  },
});

Deno.test("EDGE: Variant with unevaluatedProperties recursion", async () => {
  // This pattern is particularly tricky
  const schema: Schema = {
    oneOf: [
      { properties: { type: { const: "A" } } },
      { properties: { type: { const: "B" } } },
    ],
    unevaluatedProperties: { $ref: "#" },
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // unevaluatedProperties with variants is complex
  assertEquals(
    result.valid,
    true,
    "Should process unevaluatedProperties with variants",
  );
  assertExists(result.schema, "Should return processed schema");
  assertEquals(
    result.schema.refs.cyclic.has("#"),
    true,
    "Should detect root cycle",
  );
});

Deno.test({
  name: "EDGE: Deep variant stack without recursion",
  
  async fn() {
    // Not all deep nesting is recursive - this should be fast
    let schema: Schema = { type: "string" };
    for (let i = 0; i < 50; i++) {
      schema = {
        oneOf: [
          schema,
          { type: "number" },
        ],
      };
    }

    const processor = new JsonSchemaProcessor();
    const start = performance.now();
    const result = await processor.process(schema);
    const duration = performance.now() - start;

    // Deep non-recursive nesting should still be fast
    assertEquals(result.valid, true, "Should process deep variant nesting");
    assertExists(result.schema, "Should return processed schema");
    assertEquals(
      result.schema.refs.cyclic.size,
      0,
      "Should not detect cycles (no refs)",
    );
    assertEquals(
      duration < 3000,
      true,
      `Should complete in < 3s (took ${duration.toFixed(2)}ms)`,
    );
  },
});
