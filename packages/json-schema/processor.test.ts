/**
 * Tests for JSON Schema Processor
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { JsonSchemaProcessor } from "./processor.ts";
import type { Schema } from "./types.ts";

Deno.test("JsonSchemaProcessor - process valid schema", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer", minimum: 0 },
    },
    required: ["name"],
  };

  const result = await processor.process(schema);
  
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.schema?.root, schema);
  assertEquals(result.metadata?.totalSchemas, 3); // root + 2 properties
});

Deno.test("JsonSchemaProcessor - process schema with references", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      user: { $ref: "#/$defs/User" },
    },
    $defs: {
      User: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
        },
      },
    },
  };

  const result = await processor.process(schema);
  
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  
  assertEquals(result.schema?.refs.resolved.size, 1);
  assertEquals(result.schema?.refs.resolved.has("#/$defs/User"), true);
});

Deno.test("JsonSchemaProcessor - handle invalid schema", async () => {
  const processor = new JsonSchemaProcessor();
  const invalidSchema = {
    type: "invalid-type", // Invalid type
    properties: "not-an-object", // Invalid properties
  };

  const result = await processor.process(invalidSchema);
  
  assertEquals(result.valid, false);
  assertEquals(result.errors.length > 0, true);
});

Deno.test("JsonSchemaProcessor - detect circular references", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      self: { $ref: "#" }, // Circular reference
    },
  };

  const result = await processor.process(schema);
  
  assertEquals(result.valid, true);
  assertEquals(result.warnings.length >= 0, true); // May or may not have warnings
  
  assertEquals(result.schema?.refs.cyclic.size > 0, true);
});

Deno.test("JsonSchemaProcessor - process boolean schema", async () => {
  const processor = new JsonSchemaProcessor();
  
  // true schema allows anything
  const trueResult = await processor.process(true);
  assertEquals(trueResult.valid, true);
  assertEquals(trueResult.schema?.root, true);
  
  // false schema allows nothing
  const falseResult = await processor.process(false);
  assertEquals(falseResult.valid, true);
  assertEquals(falseResult.schema?.root, false);
});

Deno.test("JsonSchemaProcessor - process complex schema", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { 
        type: "integer",
        minimum: 0,
        maximum: 150,
      },
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
          country: { type: "string", enum: ["US", "UK", "CA"] },
        },
        required: ["street", "city"],
      },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    },
    required: ["name", "address"],
    additionalProperties: false,
  };

  const result = await processor.process(schema);
  
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  // Check metadata exists and has expected features
  assertEquals(result.metadata !== undefined, true);
  if (result.metadata) {
    assertEquals(result.metadata.features.has("enum"), true);
    assertEquals(result.metadata.features.has("required"), true);
    assertEquals(result.metadata.complexity.score > 0, true);
  }
});