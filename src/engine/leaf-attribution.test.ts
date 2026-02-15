import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import type { Schema } from "@steady/json-schema";
import { attributeLeaf, attributeLeafCode } from "./leaf-attribution.ts";
import type { LeafNode } from "./leaf-attribution.ts";

const EMPTY_SCHEMA: Schema = {};

function makeNode(
  overrides: Partial<LeafNode> & { keyword: string },
): LeafNode {
  return {
    path: "body",
    schemaPath: "#/test",
    valid: false,
    ...overrides,
  };
}

Deno.test("attributeLeafCode", async (t) => {
  // ── type keyword ────────────────────────────────────────────────────

  await t.step("type in path → E3001", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "type" }), EMPTY_SCHEMA, "path"),
      "E3001",
    );
  });

  await t.step("type in query → E3003", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "type" }), EMPTY_SCHEMA, "query"),
      "E3003",
    );
  });

  await t.step("type in header → E3008", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "type" }), EMPTY_SCHEMA, "header"),
      "E3008",
    );
  });

  await t.step("type in body → E3008", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "type" }), EMPTY_SCHEMA, "body"),
      "E3008",
    );
  });

  await t.step("type with null actual and non-nullable schema → E5001", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "type", actual: null }),
        { type: "string" },
        "body",
      ),
      "E5001",
    );
  });

  await t.step(
    "type with null actual and nullable schema → E3008 (not E5001)",
    () => {
      assertEquals(
        attributeLeafCode(
          makeNode({ keyword: "type", actual: null }),
          { type: ["string", "null"] },
          "body",
        ),
        "E3008",
      );
    },
  );

  await t.step(
    "type with null actual and OpenAPI nullable → E3008 (not E5001)",
    () => {
      assertEquals(
        attributeLeafCode(
          makeNode({ keyword: "type", actual: null }),
          { type: "string", nullable: true },
          "body",
        ),
        "E3008",
      );
    },
  );

  await t.step("type for array item in body → E3010", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "type", path: "body.tags.0", arrayItem: true }),
        { type: "string" },
        "body",
      ),
      "E3010",
    );
  });

  await t.step(
    "type for nested property within array item → E3008 (not E3010)",
    () => {
      assertEquals(
        attributeLeafCode(
          makeNode({ keyword: "type", path: "body.users.0.name" }),
          { type: "string" },
          "body",
        ),
        "E3008",
      );
    },
  );

  // ── required keyword ────────────────────────────────────────────────

  await t.step("required in query → E3002", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "required" }),
        EMPTY_SCHEMA,
        "query",
      ),
      "E3002",
    );
  });

  await t.step("required in header → E3004", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "required" }),
        EMPTY_SCHEMA,
        "header",
      ),
      "E3004",
    );
  });

  await t.step("required in body → E3007", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "required" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E3007",
    );
  });

  // ── additionalProperties ────────────────────────────────────────────

  await t.step("additionalProperties explicitly false → E3009", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "additionalProperties" }),
        { additionalProperties: false },
        "body",
      ),
      "E3009",
    );
  });

  await t.step("additionalProperties spec silent → E5003", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "additionalProperties" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E5003",
    );
  });

  // ── enum / const ────────────────────────────────────────────────────

  await t.step("enum → E3016", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "enum" }), EMPTY_SCHEMA, "body"),
      "E3016",
    );
  });

  await t.step("const → E3017", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "const" }), EMPTY_SCHEMA, "body"),
      "E3017",
    );
  });

  // ── format ──────────────────────────────────────────────────────────

  await t.step("format binary → E3018", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "format" }),
        { format: "binary" },
        "body",
      ),
      "E3018",
    );
  });

  await t.step("format byte → E3018", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "format" }),
        { format: "byte" },
        "body",
      ),
      "E3018",
    );
  });

  await t.step("format email → E4001", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "format" }),
        { format: "email" },
        "body",
      ),
      "E4001",
    );
  });

  await t.step("format uri → E4001", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "format" }),
        { format: "uri" },
        "body",
      ),
      "E4001",
    );
  });

  // ── Content keywords ────────────────────────────────────────────────

  await t.step("pattern → E4002", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "pattern" }), EMPTY_SCHEMA, "body"),
      "E4002",
    );
  });

  await t.step("minLength → E4003", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "minLength" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4003",
    );
  });

  await t.step("maxLength → E4003", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "maxLength" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4003",
    );
  });

  await t.step("minimum → E4004", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "minimum" }), EMPTY_SCHEMA, "body"),
      "E4004",
    );
  });

  await t.step("maximum → E4004", () => {
    assertEquals(
      attributeLeafCode(makeNode({ keyword: "maximum" }), EMPTY_SCHEMA, "body"),
      "E4004",
    );
  });

  await t.step("exclusiveMinimum → E4004", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "exclusiveMinimum" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4004",
    );
  });

  await t.step("exclusiveMaximum → E4004", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "exclusiveMaximum" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4004",
    );
  });

  await t.step("minItems → E4005", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "minItems" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4005",
    );
  });

  await t.step("maxItems → E4005", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "maxItems" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4005",
    );
  });

  await t.step("multipleOf → E4007", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "multipleOf" }),
        EMPTY_SCHEMA,
        "body",
      ),
      "E4007",
    );
  });

  await t.step("minProperties → E4002", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "minProperties" }),
        { minProperties: 1 },
        "body",
      ),
      "E4002",
    );
  });

  await t.step("maxProperties → E4002", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "maxProperties" }),
        { maxProperties: 5 },
        "body",
      ),
      "E4002",
    );
  });

  await t.step("uniqueItems → E4002", () => {
    assertEquals(
      attributeLeafCode(
        makeNode({ keyword: "uniqueItems" }),
        { uniqueItems: true },
        "body",
      ),
      "E4002",
    );
  });
});

Deno.test("attributeLeaf", async (t) => {
  await t.step("produces a complete Diagnostic", async (t) => {
    const node = makeNode({
      keyword: "type",
      path: "body.email",
      schemaPath: "#/components/schemas/User/properties/email/type",
      message: "Expected string, got integer",
      expected: "string",
      actual: 42,
    });

    const diag = attributeLeaf(node, { type: "string" }, "body");

    assertEquals(diag.code, "E3008");
    assertEquals(diag.severity, "error");
    assertEquals(diag.category, "sdk-issue");
    assertEquals(diag.requestPath, "body.email");
    assertEquals(
      diag.specPointer,
      "#/components/schemas/User/properties/email/type",
    );
    assertEquals(diag.message, "Expected string, got integer");
    assertEquals(diag.expected, "string");
    assertEquals(diag.actual, 42);
    assertEquals(diag.attribution.confidence, 1.0);
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("uses E-code title when node has no message", () => {
    const node = makeNode({
      keyword: "required",
      path: "body",
      schemaPath: "#/test",
    });

    const diag = attributeLeaf(node, EMPTY_SCHEMA, "body");

    assertEquals(diag.message, "Missing required field");
  });

  await t.step("ambiguous codes get lower confidence", () => {
    const node = makeNode({
      keyword: "type",
      actual: null,
    });

    const diag = attributeLeaf(node, { type: "string" }, "body");

    assertEquals(diag.code, "E5001");
    assertEquals(diag.category, "ambiguous");
    assertEquals(diag.attribution.confidence, 0.5);
  });
});

// ── Reasoning chain content ───────────────────────────────────────

Deno.test("reasoning chains", async (t) => {
  await t.step("E3008 type mismatch", async (t) => {
    const node = makeNode({
      keyword: "type",
      path: "body.email",
      expected: "string",
      actual: "integer",
    });
    const diag = attributeLeaf(node, { type: "string" }, "body");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3007 missing required body field", async (t) => {
    const node = makeNode({
      keyword: "required",
      path: "body.file",
      field: "file",
    });
    const diag = attributeLeaf(
      node,
      { required: ["file", "model"] },
      "body",
    );
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E5001 null non-nullable", async (t) => {
    const node = makeNode({
      keyword: "type",
      path: "body.name",
      actual: null,
    });
    const diag = attributeLeaf(node, { type: "string" }, "body");
    assertEquals(diag.code, "E5001");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3002 missing required query param", async (t) => {
    const node = makeNode({
      keyword: "required",
      path: "query.limit",
      field: "limit",
    });
    const diag = attributeLeaf(node, {}, "query");
    assertEquals(diag.code, "E3002");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3004 missing required header", async (t) => {
    const node = makeNode({
      keyword: "required",
      path: "header.authorization",
      field: "authorization",
    });
    const diag = attributeLeaf(node, {}, "header");
    assertEquals(diag.code, "E3004");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3009 additional property (false)", async (t) => {
    const node = makeNode({
      keyword: "additionalProperties",
      path: "body.foo",
      field: "foo",
    });
    const diag = attributeLeaf(
      node,
      { additionalProperties: false },
      "body",
    );
    assertEquals(diag.code, "E3009");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E5003 additional property (spec silent)", async (t) => {
    const node = makeNode({
      keyword: "additionalProperties",
      path: "body.foo",
      field: "foo",
    });
    const diag = attributeLeaf(node, {}, "body");
    assertEquals(diag.code, "E5003");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3016 enum mismatch", async (t) => {
    const node = makeNode({
      keyword: "enum",
      path: "body.status",
      actual: "invalid",
    });
    const diag = attributeLeaf(
      node,
      { enum: ["active", "inactive"] },
      "body",
    );
    assertEquals(diag.code, "E3016");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3017 const mismatch", async (t) => {
    const node = makeNode({
      keyword: "const",
      path: "body.version",
      expected: "v2",
      actual: "v1",
    });
    const diag = attributeLeaf(node, { const: "v2" }, "body");
    assertEquals(diag.code, "E3017");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4002 pattern mismatch", async (t) => {
    const node = makeNode({
      keyword: "pattern",
      path: "body.email",
      expected: "^.+@.+$",
      actual: "notanemail",
    });
    const diag = attributeLeaf(
      node,
      { pattern: "^.+@.+$" },
      "body",
    );
    assertEquals(diag.code, "E4002");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4003 string length (minLength)", async (t) => {
    const node = makeNode({
      keyword: "minLength",
      path: "body.name",
      expected: 1,
      actual: 0,
    });
    const diag = attributeLeaf(node, { minLength: 1 }, "body");
    assertEquals(diag.code, "E4003");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4004 numeric range (minimum)", async (t) => {
    const node = makeNode({
      keyword: "minimum",
      path: "body.age",
      expected: 0,
      actual: -5,
    });
    const diag = attributeLeaf(node, { minimum: 0 }, "body");
    assertEquals(diag.code, "E4004");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4005 array size (minItems)", async (t) => {
    const node = makeNode({
      keyword: "minItems",
      path: "body.tags",
      expected: 1,
      actual: 0,
    });
    const diag = attributeLeaf(node, { minItems: 1 }, "body");
    assertEquals(diag.code, "E4005");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4007 multipleOf", async (t) => {
    const node = makeNode({
      keyword: "multipleOf",
      path: "body.quantity",
      expected: 5,
      actual: 7,
    });
    const diag = attributeLeaf(node, { multipleOf: 5 }, "body");
    assertEquals(diag.code, "E4007");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3018 structural format mismatch", async (t) => {
    const node = makeNode({
      keyword: "format",
      path: "body.file",
      expected: "binary",
      actual: "not-binary",
    });
    const diag = attributeLeaf(node, { format: "binary" }, "body");
    assertEquals(diag.code, "E3018");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4001 content format mismatch", async (t) => {
    const node = makeNode({
      keyword: "format",
      path: "body.email",
      expected: "email",
      actual: "notanemail",
    });
    const diag = attributeLeaf(node, { format: "email" }, "body");
    assertEquals(diag.code, "E4001");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E3010 array item type mismatch", async (t) => {
    const node = makeNode({
      keyword: "type",
      path: "body.tags.0",
      expected: "string",
      actual: "integer",
      arrayItem: true,
    });
    const diag = attributeLeaf(node, { type: "string" }, "body");
    assertEquals(diag.code, "E3010");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("E4005 array size (maxItems)", async (t) => {
    const node = makeNode({
      keyword: "maxItems",
      path: "body.tags",
      expected: 3,
      actual: 10,
    });
    const diag = attributeLeaf(node, { maxItems: 3 }, "body");
    assertEquals(diag.code, "E4005");
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("minProperties reasoning", async (t) => {
    const node = makeNode({
      keyword: "minProperties",
      path: "body.metadata",
      actual: 0,
    });
    const diag = attributeLeaf(
      node,
      { minProperties: 1 },
      "body",
    );
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("maxProperties reasoning", async (t) => {
    const node = makeNode({
      keyword: "maxProperties",
      path: "body.metadata",
      actual: 10,
    });
    const diag = attributeLeaf(
      node,
      { maxProperties: 5 },
      "body",
    );
    await assertSnapshot(t, diag.attribution.reasoning);
  });

  await t.step("uniqueItems reasoning", async (t) => {
    const node = makeNode({
      keyword: "uniqueItems",
      path: "body.tags",
      actual: ["a", "a"],
    });
    const diag = attributeLeaf(
      node,
      { uniqueItems: true },
      "body",
    );
    await assertSnapshot(t, diag.attribution.reasoning);
  });
});

// ── Display context ──────────────────────────────────────────────

Deno.test("display context", async (t) => {
  await t.step("type keyword shows schema type", async (t) => {
    const node = makeNode({
      keyword: "type",
      path: "body.email",
      expected: "string",
      actual: "integer",
    });
    const diag = attributeLeaf(node, { type: "string" }, "body");
    await assertSnapshot(t, diag.display);
  });

  await t.step("required keyword shows required array", async (t) => {
    const node = makeNode({
      keyword: "required",
      path: "body.file",
      field: "file",
    });
    const diag = attributeLeaf(
      node,
      { required: ["name", "email", "file"] },
      "body",
    );
    await assertSnapshot(t, diag.display);
  });

  await t.step(
    "additionalProperties false shows constraint",
    async (t) => {
      const node = makeNode({
        keyword: "additionalProperties",
        path: "body.foo",
        field: "foo",
      });
      const diag = attributeLeaf(
        node,
        { additionalProperties: false },
        "body",
      );
      await assertSnapshot(t, diag.display);
    },
  );

  await t.step("enum shows allowed values", async (t) => {
    const node = makeNode({
      keyword: "enum",
      path: "body.status",
      actual: "invalid",
    });
    const diag = attributeLeaf(
      node,
      { enum: ["active", "inactive", "pending"] },
      "body",
    );
    await assertSnapshot(t, diag.display);
  });

  await t.step("const shows expected value", async (t) => {
    const node = makeNode({
      keyword: "const",
      path: "body.version",
      expected: "v2",
      actual: "v1",
    });
    const diag = attributeLeaf(node, { const: "v2" }, "body");
    await assertSnapshot(t, diag.display);
  });

  await t.step("enum with many values truncates display", () => {
    const longEnum = Array.from({ length: 50 }, (_, i) => `value_${i}`);
    const node = makeNode({
      keyword: "enum",
      path: "body.status",
      actual: "invalid",
    });
    const diag = attributeLeaf(node, { enum: longEnum }, "body");
    const context = diag.display?.context;
    const text = context?.[0]?.text;
    // Display text should be bounded (enum: prefix + 80 char max)
    assertEquals(typeof text, "string");
    assertEquals((text ?? "").length <= 86, true); // "enum: " (6) + 80
    assertEquals((text ?? "").endsWith("..."), true);
  });

  await t.step("array type uses bracket syntax in display", () => {
    const node = makeNode({
      keyword: "type",
      path: "body.name",
      expected: "string",
      actual: 42,
    });
    const diag = attributeLeaf(
      node,
      { type: ["string", "null"] },
      "body",
    );
    const context = diag.display?.context;
    const ctx = context?.[0];
    assertEquals(ctx?.text, "type: [string, null]");
    // Highlight covers "string, null"
    assertEquals(ctx?.highlight?.start, 7);
    assertEquals(ctx?.highlight?.end, 7 + "string, null".length);
  });

  await t.step("scalar type uses quote syntax in display", () => {
    const node = makeNode({
      keyword: "type",
      path: "body.name",
      expected: "string",
      actual: 42,
    });
    const diag = attributeLeaf(node, { type: "string" }, "body");
    const context = diag.display?.context;
    assertEquals(context?.[0]?.text, 'type: "string"');
  });

  await t.step("pattern keyword has no display context", () => {
    const node = makeNode({
      keyword: "pattern",
      path: "body.email",
      actual: "bad",
    });
    const diag = attributeLeaf(
      node,
      { pattern: "^.+@.+$" },
      "body",
    );
    assertEquals(diag.display, undefined);
  });
});
