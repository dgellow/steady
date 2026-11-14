import { assertEquals } from "@std/assert";
import { formatFragmentPointer } from "@steady/json-pointer";
import { normalizeSchemaShape, type ShapeProblem } from "./schema-shape.ts";

/** Normalize `schema` held at #/s and return it with the problems found. */
function normalize(schema: unknown): {
  schema: unknown;
  present: boolean;
  problems: string[];
} {
  const holder: Record<string, unknown> = { s: schema };
  const problems: ShapeProblem[] = [];
  const present = normalizeSchemaShape(holder, "s", ["s"], (p) => {
    problems.push(p);
  });
  return {
    schema: holder.s,
    present,
    problems: problems.map((p) =>
      `${
        formatFragmentPointer(p.path)
      }: expected ${p.expected}, found ${p.actual}`
    ),
  };
}

Deno.test("normalizeSchemaShape: a well-formed schema is left alone", () => {
  const schema = {
    type: ["object", "null"],
    required: ["id"],
    properties: {
      id: { type: "string", pattern: "^[a-z]+$", minLength: 1 },
      tags: { type: "array", items: { type: "string" }, uniqueItems: true },
      n: { type: "number", minimum: 0, exclusiveMaximum: true },
    },
    additionalProperties: false,
    allOf: [{ $ref: "#/components/schemas/Base" }, true],
    not: { const: null },
    enum: [1, "a", null],
    discriminator: { propertyName: "kind", mapping: { a: "#/x" } },
    "x-anything": 5,
  };
  const before = JSON.stringify(schema);
  const result = normalize(schema);
  assertEquals(result.present, true);
  assertEquals(result.problems, []);
  assertEquals(JSON.stringify(result.schema), before);
});

Deno.test("normalizeSchemaShape: boolean schemas are schemas", () => {
  assertEquals(normalize(true).problems, []);
  assertEquals(normalize(false).schema, false);
});

Deno.test("normalizeSchemaShape: a value that is not a schema is removed", () => {
  for (const value of [null, 5, "x", [], [1]]) {
    const result = normalize(value);
    assertEquals(result.present, false);
    assertEquals(result.schema, undefined);
    assertEquals(result.problems.length, 1);
  }
  assertEquals(normalize(5).problems, [
    "#/s: expected a schema (an object or a boolean), found number",
  ]);
});

Deno.test("normalizeSchemaShape: keywords of the wrong type are removed, the rest stays", () => {
  const result = normalize({
    type: 5,
    required: true,
    enum: "a",
    pattern: ["x"],
    minLength: -1,
    maximum: "10",
    uniqueItems: "yes",
    properties: [],
    allOf: { 0: {} },
    items: 3,
    additionalProperties: "no",
    discriminator: "kind",
    format: "uuid",
    description: "kept",
  });
  assertEquals(result.schema, { format: "uuid", description: "kept" });
  assertEquals(result.problems.sort(), [
    "#/s/additionalProperties: expected a schema (an object or a boolean), found string",
    "#/s/allOf: expected an array of schemas, found object",
    "#/s/discriminator: expected an object with a string propertyName and an optional mapping of strings, found string",
    "#/s/enum: expected an array, found string",
    "#/s/items: expected a schema (an object or a boolean), found number",
    "#/s/maximum: expected a number, found string",
    "#/s/minLength: expected a non-negative integer, found number",
    "#/s/pattern: expected a string, found array",
    "#/s/properties: expected an object of schemas, found array",
    "#/s/required: expected an array of strings, found boolean",
    "#/s/type: expected a string or an array of strings, found number",
    "#/s/uniqueItems: expected a boolean, found string",
  ]);
});

Deno.test("normalizeSchemaShape: schemas below the top are checked where they are", () => {
  const result = normalize({
    properties: {
      good: { type: "string" },
      bad: 5,
      deep: { items: { allOf: [{ required: "id" }, "x", { oneOf: 1 }] } },
    },
    prefixItems: [null, { type: "integer" }],
    $defs: { A: { not: [] } },
  });
  assertEquals(result.schema, {
    properties: {
      good: { type: "string" },
      deep: { items: { allOf: [{}, {}] } },
    },
    prefixItems: [{ type: "integer" }],
    $defs: { A: {} },
  });
  // Array positions are those of the document, before anything was removed.
  assertEquals(result.problems.sort(), [
    "#/s/$defs/A/not: expected a schema (an object or a boolean), found array",
    "#/s/prefixItems/0: expected a schema (an object or a boolean), found null",
    "#/s/properties/bad: expected a schema (an object or a boolean), found number",
    "#/s/properties/deep/items/allOf/0/required: expected an array of strings, found string",
    "#/s/properties/deep/items/allOf/1: expected a schema (an object or a boolean), found string",
    "#/s/properties/deep/items/allOf/2/oneOf: expected an array of schemas, found number",
  ]);
});

Deno.test("normalizeSchemaShape: property names that are also keywords or prototype members", () => {
  // `properties` maps names to schemas; a property called "required" or
  // "constructor" is a name, not a keyword.
  const result = normalize({
    properties: {
      required: { type: "boolean" },
      type: { type: "string" },
      constructor: { type: "string" },
      toString: { enum: 5 },
    },
  });
  assertEquals(result.problems, [
    "#/s/properties/toString/enum: expected an array, found number",
  ]);
});

Deno.test("normalizeSchemaShape: nesting far beyond the call stack", () => {
  let schema: Record<string, unknown> = { enum: 5 };
  for (let i = 0; i < 100_000; i++) schema = { items: schema };
  const result = normalize(schema);
  assertEquals(result.problems.length, 1);
});
