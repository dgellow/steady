/**
 * Tests for circular reference detection in JSON Schema processor
 */

import { assertEquals } from "@std/assert";
import { JsonSchemaProcessor } from "./processor.ts";
import type { Schema } from "./types.ts";

Deno.test("Cycle Detection - direct self-reference", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    $ref: "#",
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  assertEquals(result.schema?.refs.cyclic.size, 1);
  assertEquals(result.schema?.refs.cyclic.has("#"), true);
});

Deno.test("Cycle Detection - property references parent", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      self: { $ref: "#" },
    },
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  assertEquals(result.schema?.refs.cyclic.size, 2);
  assertEquals(result.schema?.refs.cyclic.has("#"), true);
  assertEquals(result.schema?.refs.cyclic.has("#/properties/self"), true);
});

Deno.test("Cycle Detection - two-step cycle", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    $defs: {
      A: { $ref: "#/$defs/B" },
      B: { $ref: "#/$defs/A" },
    },
    $ref: "#/$defs/A",
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  assertEquals(result.schema!.refs.cyclic.size >= 2, true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/A"), true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/B"), true);
});

Deno.test("Cycle Detection - three-step cycle", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    $defs: {
      A: { $ref: "#/$defs/B" },
      B: { $ref: "#/$defs/C" },
      C: { $ref: "#/$defs/A" },
    },
    $ref: "#/$defs/A",
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  assertEquals(result.schema!.refs.cyclic.size >= 3, true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/A"), true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/B"), true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/C"), true);
});

Deno.test("Cycle Detection - nested property cycle", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      nested: {
        type: "object",
        properties: {
          parent: { $ref: "#" },
          sibling: { $ref: "#/properties/nested" },
        },
      },
    },
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  // Should detect cycles for references that point to parent paths
  assertEquals(result.schema!.refs.cyclic.size > 0, true);
});

Deno.test("Cycle Detection - no cycle with forward references", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    type: "object",
    properties: {
      a: { $ref: "#/$defs/StringType" },
      b: { $ref: "#/$defs/NumberType" },
    },
    $defs: {
      StringType: { type: "string" },
      NumberType: { type: "number" },
    },
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  assertEquals(result.schema?.refs.cyclic.size, 0);
});

Deno.test("Cycle Detection - complex mixed references", async () => {
  const processor = new JsonSchemaProcessor();
  const schema: Schema = {
    $defs: {
      Person: {
        type: "object",
        properties: {
          name: { type: "string" },
          spouse: { $ref: "#/$defs/Person" }, // Recursive but not circular
          children: {
            type: "array",
            items: { $ref: "#/$defs/Person" }, // Also recursive
          },
        },
      },
      // This creates a cycle
      A: {
        allOf: [
          { $ref: "#/$defs/B" },
          { type: "object" },
        ],
      },
      B: {
        properties: {
          a: { $ref: "#/$defs/A" },
        },
      },
    },
    type: "object",
    properties: {
      person: { $ref: "#/$defs/Person" },
      a: { $ref: "#/$defs/A" },
    },
  };

  const result = await processor.process(schema);

  assertEquals(result.valid, true);
  // Should detect the A-B cycle
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/A"), true);
  assertEquals(result.schema!.refs.cyclic.has("#/$defs/B"), true);
});
