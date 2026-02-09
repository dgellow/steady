import { assertEquals } from "@std/assert";
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
});

Deno.test("attributeLeaf", async (t) => {
  await t.step("produces a complete Diagnostic", () => {
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
    assertEquals(diag.attribution.confidence, 0.9);
    assertEquals(diag.attribution.reasoning.length, 1);
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
