import { assertEquals } from "@std/assert";
import type { FragmentPointer } from "@steady/json-pointer";
import type { Schema } from "./types.ts";
import { TreeValidator } from "./tree-validator.ts";

/**
 * Helper: validate data against a schema and return the tree.
 * Uses a default schemaPath and dataPath unless overridden.
 */
function validate(
  schema: Schema,
  data: unknown,
  schemaPath: FragmentPointer = "#/schema",
  dataPath = ["body"],
) {
  const validator = new TreeValidator();
  return validator.validate(data, schema, schemaPath, dataPath);
}

Deno.test("TreeValidator", async (t) => {
  // ── Valid data ───────────────────────────────────────────────────

  await t.step("valid data → valid node", () => {
    const tree = validate({ type: "string" }, "hello");

    assertEquals(tree.valid, true);
    assertEquals(tree.path, ["body"]);
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
    assertEquals(leaf.path, ["body"]);
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
    assertEquals(leaves[0]!.path, ["body"]);
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

  // ── properties (applicator, flattened) ──────────────────────────

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
    assertEquals(leaf.path, ["body", "name"]);
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
    assertEquals(leaf.path, ["body", "address", "city"]);
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

  await t.step("string length counts code points, not UTF-16 units", () => {
    // JSON Schema Validation section 6.3: length is the number of characters
    // as defined by RFC 8259. U+1F600 is one character and two UTF-16 units.
    const face = "\u{1F600}";
    assertEquals(validate({ type: "string", maxLength: 1 }, face).valid, true);
    assertEquals(validate({ type: "string", minLength: 2 }, face).valid, false);

    const tree = validate({ type: "string", maxLength: 1 }, face + face);
    const leaf = tree.children?.find((c) => c.keyword === "maxLength");
    assertEquals(leaf?.actual, 2);
  });

  // ── Names that exist on Object.prototype ─────────────────────────

  await t.step("required: an inherited member does not satisfy it", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty"]) {
      const tree = validate({ type: "object", required: [name] }, {});
      assertEquals(tree.valid, false, name);
      assertEquals(tree.children?.[0]?.keyword, "required", name);
      assertEquals(tree.children?.[0]?.field, name, name);

      const present = validate({ type: "object", required: [name] }, {
        [name]: 1,
      });
      assertEquals(present.valid, true, name);
    }
  });

  await t.step("properties: an inherited member is not validated", () => {
    // {} has no member "toString", so the property schema does not apply.
    const stringSchema: Schema = { type: "string" };
    const properties: Record<string, Schema> = {};
    properties["toString"] = stringSchema;
    properties["valueOf"] = stringSchema;

    const tree = validate({ type: "object", properties }, {});
    assertEquals(tree.valid, true);
  });

  await t.step(
    "required with direction: a property schema is only read from the schema",
    () => {
      // "constructor" is required but not declared in properties. The
      // readOnly filter must not mistake Object.prototype.constructor for
      // its property schema.
      const validator = new TreeValidator({ direction: "request" });
      const tree = validator.validate(
        {},
        {
          type: "object",
          required: ["constructor"],
          properties: { id: { type: "string" } },
        },
        "#/schema",
        ["body"],
      );
      assertEquals(tree.valid, false);
      assertEquals(tree.children?.[0]?.field, "constructor");
    },
  );

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

  await t.step("multipleOf with floats uses epsilon comparison", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754
    // Naive `data % multipleOf !== 0` would incorrectly fail here
    const tree = validate({ type: "number", multipleOf: 0.01 }, 0.3);
    assertEquals(tree.valid, true);
  });

  await t.step("multipleOf still catches real violations", () => {
    const tree = validate({ type: "number", multipleOf: 3 }, 7);
    assertEquals(tree.valid, false);
    const leaf = tree.children?.find((c) => c.keyword === "multipleOf");
    assertEquals(leaf?.valid, false);
  });

  // ── Array validation ─────────────────────────────────────────────

  await t.step(
    "uniqueItems with different key order → detects duplicates",
    () => {
      // JSON.stringify({a:1,b:2}) !== JSON.stringify({b:2,a:1})
      // But they ARE semantically equal, so uniqueItems should detect this
      const tree = validate(
        { type: "array", uniqueItems: true },
        [{ a: 1, b: 2 }, { b: 2, a: 1 }],
      );
      assertEquals(tree.valid, false);
      const leaf = tree.children?.find((c) => c.keyword === "uniqueItems");
      assertEquals(leaf !== undefined, true);
    },
  );

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
      assertEquals(leaf.path, ["body", "1"]);
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
      assertEquals(leaf.path, ["body", "0", "name"]);
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
    assertEquals(leaf.path, ["body", "user"]);
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

  // ── not keyword ──────────────────────────────────────────────────

  await t.step("not: rejects data matching inner schema", () => {
    const tree = validate({ not: { type: "string" } }, "hello");

    assertEquals(tree.valid, false);
    assertEquals(tree.children?.length, 1);

    const leaf = tree.children![0]!;
    assertEquals(leaf.keyword, "not");
    assertEquals(leaf.valid, false);
    assertEquals(leaf.path, ["body"]);
    // Composition keyword errors point to the containing schema, matching
    // the leaf keyword convention. The `keyword` field identifies which
    // keyword failed.
    assertEquals(leaf.schemaPath, "#/schema");
  });

  await t.step("not: accepts data NOT matching inner schema", () => {
    const tree = validate({ not: { type: "string" } }, 42);
    assertEquals(tree.valid, true);
  });

  await t.step("not: empty schema in not rejects everything", () => {
    // not: {} means "not anything" = nothing passes
    const tree = validate({ not: {} }, "anything");
    assertEquals(tree.valid, false);
  });

  await t.step("not: complex inner schema", () => {
    const schema: Schema = {
      type: "object",
      not: {
        required: ["forbidden_field"],
      },
    };

    // Object without the forbidden field should pass
    const pass = validate(schema, { name: "ok" });
    assertEquals(pass.valid, true);

    // Object with the forbidden field should fail
    const fail = validate(schema, { forbidden_field: "oops" });
    assertEquals(fail.valid, false);
  });

  // ── Boolean schemas (JSON Schema 2020-12 / OpenAPI 3.1) ─────────

  await t.step("boolean false schema rejects all values", () => {
    // Per JSON Schema 2020-12 spec: `false` is equivalent to { "not": {} }
    const tree = validate(false as unknown as Schema, "anything");
    assertEquals(tree.valid, false);
  });

  await t.step("boolean true schema accepts all values", () => {
    // Per JSON Schema 2020-12 spec: `true` is equivalent to {}
    const tree = validate(true as unknown as Schema, "anything");
    assertEquals(tree.valid, true);
  });

  await t.step("allOf containing boolean false rejects", () => {
    const schema = {
      allOf: [false, { type: "object" }],
    } as unknown as Schema;
    const tree = validate(schema, {});
    assertEquals(tree.valid, false);
  });

  await t.step("oneOf containing only boolean false rejects", () => {
    const schema = {
      oneOf: [false],
    } as unknown as Schema;
    const tree = validate(schema, "anything");
    assertEquals(tree.valid, false);
  });

  await t.step("anyOf containing only boolean false rejects", () => {
    const schema = {
      anyOf: [false],
    } as unknown as Schema;
    const tree = validate(schema, "anything");
    assertEquals(tree.valid, false);
  });

  await t.step("anyOf with boolean false and matching variant passes", () => {
    // anyOf: at least one must match. false never matches, but string does.
    const schema = {
      anyOf: [false, { type: "string" }],
    } as unknown as Schema;
    const tree = validate(schema, "hello");
    assertEquals(tree.valid, true);
  });

  await t.step("oneOf with boolean false counts false as non-match", () => {
    // oneOf: exactly one must match. false never matches, string does = 1 match = pass.
    const schema = {
      oneOf: [false, { type: "string" }],
    } as unknown as Schema;
    const tree = validate(schema, "hello");
    assertEquals(tree.valid, true);
  });

  // ── direction-aware required (readOnly / writeOnly) ───────────

  await t.step(
    "direction=request: readOnly property skipped from required",
    () => {
      const v = new TreeValidator({ direction: "request" });
      const schema: Schema = {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string" },
        },
      };
      const tree = v.validate({ name: "Alice" }, schema, "#/schema", ["body"]);
      assertEquals(tree.valid, true);
    },
  );

  await t.step(
    "direction=request: non-readOnly property still required",
    () => {
      const v = new TreeValidator({ direction: "request" });
      const schema: Schema = {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string" },
        },
      };
      const tree = v.validate({ id: "123" }, schema, "#/schema", ["body"]);
      assertEquals(tree.valid, false);
      const leaf = tree.children?.[0];
      assertEquals(leaf?.keyword, "required");
      assertEquals(leaf?.field, "name");
    },
  );

  await t.step(
    "direction=response: writeOnly property skipped from required",
    () => {
      const v = new TreeValidator({ direction: "response" });
      const schema: Schema = {
        type: "object",
        required: ["password", "username"],
        properties: {
          password: { type: "string", writeOnly: true },
          username: { type: "string" },
        },
      };
      const tree = v.validate({ username: "alice" }, schema, "#/schema", [
        "body",
      ]);
      assertEquals(tree.valid, true);
    },
  );

  await t.step("no direction: readOnly property still required", () => {
    const schema: Schema = {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string", readOnly: true },
        name: { type: "string" },
      },
    };
    const tree = validate(schema, { name: "Alice" });
    assertEquals(tree.valid, false);
  });

  await t.step("direction=request: nested readOnly property skipped", () => {
    const v = new TreeValidator({ direction: "request" });
    const schema: Schema = {
      type: "object",
      required: ["address"],
      properties: {
        address: {
          type: "object",
          required: ["id", "street"],
          properties: {
            id: { type: "string", readOnly: true },
            street: { type: "string" },
          },
        },
      },
    };
    const tree = v.validate(
      { address: { street: "123 Main" } },
      schema,
      "#/schema",
      ["body"],
    );
    assertEquals(tree.valid, true);
  });

  // ── Google API pattern: properties without top-level type ────────

  await t.step(
    "properties without explicit type: object rejects wrong field type",
    () => {
      // Google API schemas often omit `type: object` at the top level
      const schema: Schema = {
        properties: {
          disabled: { type: "boolean" },
          name: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      };
      const tree = validate(schema, { disabled: "wrong_string" });
      assertEquals(tree.valid, false);
    },
  );

  await t.step("properties with type: object rejects wrong field type", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        disabled: { type: "boolean" },
        name: { type: "string" },
      },
    };
    const tree = validate(schema, { disabled: "wrong_string" });
    assertEquals(tree.valid, false);
  });
});
