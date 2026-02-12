import { assertEquals } from "@std/assert";
import type { Schema } from "./types.ts";
import type { ValidationNode } from "../../src/engine/types.ts";
import type { SchemaValidator } from "../../src/engine/diagnostic-engine.ts";
import { TreeValidator } from "./tree-validator.ts";

/**
 * Helper: validate data against a schema and return the tree.
 * Uses a default schemaPath and dataPath unless overridden.
 */
function validate(
  schema: Schema,
  data: unknown,
  schemaPath = "#/schema",
  dataPath = "body",
) {
  const validator = new TreeValidator();
  return validator.validate(data, schema, schemaPath, dataPath);
}

Deno.test("TreeValidator", async (t) => {
  // ── Valid data ───────────────────────────────────────────────────

  await t.step("valid data → valid node", () => {
    const tree = validate({ type: "string" }, "hello");

    assertEquals(tree.valid, true);
    assertEquals(tree.path, "body");
    assertEquals(tree.schemaPath, "#/schema");
  });

  await t.step("empty schema → always valid", () => {
    const tree = validate({}, "anything");
    assertEquals(tree.valid, true);
  });

  // ── type keyword ─────────────────────────────────────────────────

  await t.step("type mismatch → leaf with keyword 'type'", () => {
    const tree = validate({ type: "string" }, 42);

    assertEquals(tree.valid, false);
    assertEquals(tree.children?.length, 1);

    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "type");
    assertEquals(leaf.valid, false);
    assertEquals(leaf.expected, "string");
    assertEquals(leaf.actual, "number");
    assertEquals(leaf.path, "body");
  });

  await t.step("type array: matches any listed type", () => {
    const tree = validate({ type: ["string", "number"] }, 42);
    assertEquals(tree.valid, true);
  });

  await t.step("type array: fails if none match", () => {
    const tree = validate({ type: ["string", "number"] }, true);
    assertEquals(tree.valid, false);
  });

  await t.step("null for non-nullable → type error with actual null", () => {
    const tree = validate({ type: "string" }, null);

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "type");
    assertEquals(leaf.actual, null);
  });

  // ── required keyword ─────────────────────────────────────────────

  await t.step("missing required property → leaf with field name", () => {
    const tree = validate(
      { type: "object", required: ["name", "email"] },
      { name: "Alice" },
    );

    assertEquals(tree.valid, false);
    const leaves = tree.children?.filter((c) => c.keyword === "required") ?? [];
    assertEquals(leaves.length, 1);
    assertEquals(leaves[0]!.field, "email");
    assertEquals(leaves[0]!.path, "body");
  });

  await t.step("missing required property → leaf has expected field", () => {
    const tree = validate(
      { type: "object", required: ["name", "email"] },
      { name: "Alice" },
    );

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "required");
    assertEquals(leaf?.expected, "email");
  });

  await t.step("all required present → valid", () => {
    const tree = validate(
      { type: "object", required: ["name"] },
      { name: "Alice" },
    );
    assertEquals(tree.valid, true);
  });

  // ── properties (applicator — flattened) ──────────────────────────

  await t.step("nested property error has dotted path", () => {
    const tree = validate(
      {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      },
      { name: 42 },
    );

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "type");
    assertEquals(leaf.path, "body.name");
    assertEquals(leaf.schemaPath, "#/schema/properties/name");
  });

  await t.step("deeply nested path", () => {
    const tree = validate(
      {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      },
      { address: { city: 123 } },
    );

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.path, "body.address.city");
    assertEquals(
      leaf.schemaPath,
      "#/schema/properties/address/properties/city",
    );
  });

  // ── additionalProperties ─────────────────────────────────────────

  await t.step("additional property when false → leaf", () => {
    const tree = validate(
      {
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      { name: "Alice", extra: true },
    );

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "additionalProperties");
    assertEquals(leaf.field, "extra");
  });

  await t.step(
    "additional property when false → leaf has expected: false",
    () => {
      const tree = validate(
        {
          type: "object",
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
        { name: "Alice", extra: true },
      );

      assertEquals(tree.valid, false);
      const leaf = tree.children?.find(
        (c) => c.keyword === "additionalProperties",
      );
      assertEquals(leaf?.expected, false);
    },
  );

  // ── enum / const ─────────────────────────────────────────────────

  await t.step("enum mismatch → leaf", () => {
    const tree = validate({ enum: ["a", "b", "c"] }, "d");

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "enum");
    assertEquals(leaf.expected, ["a", "b", "c"]);
    assertEquals(leaf.actual, "d");
  });

  await t.step("const mismatch → leaf", () => {
    const tree = validate({ const: "expected" }, "actual");

    assertEquals(tree.valid, false);
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "const");
    assertEquals(leaf.expected, "expected");
    assertEquals(leaf.actual, "actual");
  });

  // ── String validation ────────────────────────────────────────────

  await t.step("pattern mismatch → leaf", () => {
    const tree = validate({ type: "string", pattern: "^\\d+$" }, "abc");

    assertEquals(tree.valid, false);
    const leaves = tree.children?.filter((c) => c.keyword === "pattern") ?? [];
    assertEquals(leaves.length, 1);
  });

  await t.step("minLength violation → leaf", () => {
    const tree = validate({ type: "string", minLength: 5 }, "hi");

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "minLength");
    assertEquals(leaf?.valid, false);
  });

  await t.step("maxLength violation → leaf", () => {
    const tree = validate({ type: "string", maxLength: 3 }, "toolong");

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "maxLength");
    assertEquals(leaf?.valid, false);
  });

  // ── Numeric validation ───────────────────────────────────────────

  await t.step("minimum violation → leaf", () => {
    const tree = validate({ type: "number", minimum: 10 }, 5);

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "minimum");
    assertEquals(leaf?.valid, false);
  });

  await t.step("maximum violation → leaf", () => {
    const tree = validate({ type: "number", maximum: 10 }, 15);

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "maximum");
    assertEquals(leaf?.valid, false);
  });

  // ── Array validation ─────────────────────────────────────────────

  await t.step(
    "array item type error has indexed path and arrayItem flag",
    () => {
      const tree = validate(
        { type: "array", items: { type: "number" } },
        [1, "two", 3],
      );

      assertEquals(tree.valid, false);
      const leaf = tree.children![0]!;
      assertEquals(leaf.keyword, "type");
      assertEquals(leaf.path, "body.1");
      assertEquals(leaf.schemaPath, "#/schema/items");
      assertEquals(leaf.arrayItem, true);
    },
  );

  await t.step(
    "array item type error through $ref has arrayItem flag",
    () => {
      const schema: Schema = {
        type: "array",
        items: { $ref: "#/$defs/Tag" },
        $defs: {
          Tag: { type: "string" },
        },
      };

      const tree = validate(schema, [42]);

      assertEquals(tree.valid, false);
      const leaf = tree.children![0]!;
      assertEquals(leaf.keyword, "type");
      assertEquals(leaf.arrayItem, true);
    },
  );

  await t.step(
    "nested property error within array item does NOT have arrayItem",
    () => {
      const tree = validate(
        {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
        [{ name: 42 }],
      );

      assertEquals(tree.valid, false);
      const leaf = tree.children![0]!;
      assertEquals(leaf.keyword, "type");
      assertEquals(leaf.path, "body.0.name");
      assertEquals(leaf.arrayItem, undefined);
    },
  );

  await t.step("uniqueItems violation → leaf has expected: true", () => {
    const tree = validate(
      { type: "array", uniqueItems: true },
      [1, 2, 1],
    );

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "uniqueItems");
    assertEquals(leaf?.expected, true);
    assertEquals(leaf?.actual, false);
  });

  await t.step("minItems violation → leaf", () => {
    const tree = validate({ type: "array", minItems: 3 }, [1]);

    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "minItems");
    assertEquals(leaf?.valid, false);
  });

  // ── oneOf composition ────────────────────────────────────────────

  await t.step("oneOf: creates composition node with variant children", () => {
    const tree = validate(
      {
        oneOf: [
          {
            type: "object",
            required: ["file"],
            properties: { file: { type: "string" } },
          },
          {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
          },
        ],
      },
      { name: "test" },
    );

    assertEquals(tree.valid, false);
    // Root should contain a oneOf composition node
    const oneOfNode = tree.children?.find((c) => c.keyword === "oneOf");
    assertEquals(oneOfNode !== undefined, true);
    assertEquals(oneOfNode!.keyword, "oneOf");
    assertEquals(oneOfNode!.valid, false);

    // Should have variant children
    assertEquals(oneOfNode!.children?.length, 2);
    assertEquals(oneOfNode!.children![0]!.variantIndex, 0);
    assertEquals(oneOfNode!.children![1]!.variantIndex, 1);
  });

  await t.step("oneOf: one variant matches → valid", () => {
    const tree = validate(
      {
        oneOf: [
          { type: "string" },
          { type: "number" },
        ],
      },
      "hello",
    );

    assertEquals(tree.valid, true);
  });

  // ── allOf composition ────────────────────────────────────────────

  await t.step("allOf: creates composition node", () => {
    const tree = validate(
      {
        allOf: [
          { type: "object", required: ["name"] },
          { type: "object", required: ["email"] },
        ],
      },
      { name: "Alice" },
    );

    assertEquals(tree.valid, false);
    const allOfNode = tree.children?.find((c) => c.keyword === "allOf");
    assertEquals(allOfNode !== undefined, true);
    assertEquals(allOfNode!.children?.length, 2);
  });

  await t.step("allOf: all subschemas pass → valid", () => {
    const tree = validate(
      {
        allOf: [
          { type: "object", required: ["name"] },
          { type: "object", required: ["email"] },
        ],
      },
      { name: "Alice", email: "a@b.com" },
    );

    assertEquals(tree.valid, true);
  });

  // ── anyOf composition ────────────────────────────────────────────

  await t.step("anyOf: one variant matches → valid", () => {
    const tree = validate(
      {
        anyOf: [
          { type: "string" },
          { type: "number" },
        ],
      },
      42,
    );

    assertEquals(tree.valid, true);
  });

  await t.step("anyOf: no variants match → composition node", () => {
    const tree = validate(
      {
        anyOf: [
          { type: "string" },
          { type: "number" },
        ],
      },
      true,
    );

    assertEquals(tree.valid, false);
    const anyOfNode = tree.children?.find((c) => c.keyword === "anyOf");
    assertEquals(anyOfNode !== undefined, true);
    assertEquals(anyOfNode!.children?.length, 2);
  });

  // ── $ref resolution ──────────────────────────────────────────────

  await t.step("$ref: resolves and validates transparently", () => {
    const rootSchema: Schema = {
      type: "object",
      properties: {
        user: { $ref: "#/$defs/User" },
      },
      $defs: {
        User: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
      },
    };

    const tree = validate(rootSchema, { user: {} });

    assertEquals(tree.valid, false);
    // The required error should have the nested path
    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "required");
    assertEquals(leaf.path, "body.user");
    assertEquals(leaf.field, "name");
  });

  // ── Multiple errors ──────────────────────────────────────────────

  await t.step("multiple errors collected as children", () => {
    const tree = validate(
      {
        type: "object",
        required: ["a", "b"],
        properties: {
          c: { type: "string" },
        },
      },
      { c: 42 },
    );

    assertEquals(tree.valid, false);
    // Should have 3 errors: required "a", required "b", type mismatch on "c"
    assertEquals(tree.children?.length, 3);
  });

  // ── Contract compatibility ──────────────────────────────────────

  await t.step("satisfies engine ValidationNode interface", () => {
    const validator = new TreeValidator();
    const tree = validator.validate(
      "hello",
      { type: "string" },
      "#/schema",
      "body",
    );

    // Compile-time check: TreeValidator output must be assignable to
    // the engine's ValidationNode. If the engine's interface changes
    // and this type drifts, this line fails at type-check time.
    const node: ValidationNode = tree;

    // Sanity: the assigned value works through the interface
    assertEquals(node.valid, true);
    assertEquals(node.path, "body");
  });

  await t.step("satisfies engine SchemaValidator interface", () => {
    // Compile-time check: TreeValidator must be assignable to the
    // engine's SchemaValidator interface. If the method signature
    // drifts, this line fails at type-check time.
    const validator: SchemaValidator = new TreeValidator();

    // Sanity: works through the interface
    const tree = validator.validate(
      "hello",
      { type: "string" },
      "#/schema",
      "body",
    );
    assertEquals(tree.valid, true);
  });
});
