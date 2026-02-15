import { assertEquals } from "@std/assert";
import type { Schema } from "@steady/json-schema";
import type { CompositionContext, InterpretResult } from "../types.ts";
import type { Diagnostic } from "../../diagnostic.ts";
import { attributeOneOf } from "./one-of.ts";

function makeDiag(
  overrides: Partial<Diagnostic> & { code: string },
): Diagnostic {
  return {
    severity: "error",
    category: "sdk-issue",
    requestPath: "body",
    specPointer: "#/test",
    message: "test",
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

function makeContext(
  schema: Schema = {},
  data: unknown = {},
): CompositionContext {
  return {
    path: ["body"],
    schemaPath: "#/oneOf",
    schema,
    data,
  };
}

Deno.test("attributeOneOf", async (t) => {
  // ── Case 2: One structural match ────────────────────────────────────

  await t.step("one structural match → returns that variant's result", () => {
    const childResults: InterpretResult[] = [
      {
        // CardPayment: pattern fails (content) → structurally valid
        diagnostics: [
          makeDiag({
            code: "E4002",
            category: "content-note",
            requestPath: "body.card_number",
          }),
        ],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        // BankPayment: required fails (structural) → structurally invalid
        diagnostics: [
          makeDiag({ code: "E3007", requestPath: "body.account_number" }),
        ],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = attributeOneOf(childResults, makeContext());

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.diagnostics[0]!.category, "content-note");
    assertEquals(result.structurallyValid, true);
  });

  await t.step("one structural match with no errors → no diagnostics", () => {
    const childResults: InterpretResult[] = [
      { diagnostics: [], structurallyValid: true, structuralFailureCount: 0 },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = attributeOneOf(childResults, makeContext());

    assertEquals(result.diagnostics.length, 0);
    assertEquals(result.structurallyValid, true);
  });

  // ── Case 3: Zero structural matches ─────────────────────────────────

  await t.step("zero matches, one closer → identifies likely variant", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007", requestPath: "body.file" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [
          makeDiag({ code: "E3007", requestPath: "body.url" }),
          makeDiag({ code: "E3007", requestPath: "body.account" }),
          makeDiag({ code: "E3008", requestPath: "body.name" }),
        ],
        structurallyValid: false,
        structuralFailureCount: 3,
      },
    ];

    const result = attributeOneOf(childResults, makeContext());

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.requestPath, "body.file");
    assertEquals(result.structurallyValid, false);
  });

  await t.step("zero matches, equally bad → E3012 ambiguous", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007", requestPath: "body.file" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [makeDiag({ code: "E3007", requestPath: "body.url" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = attributeOneOf(childResults, makeContext());

    assertEquals(result.diagnostics[0]!.code, "E3012");
    assertEquals(result.diagnostics[0]!.category, "ambiguous");
    assertEquals(result.structurallyValid, false);
  });

  // ── Case 4: Multiple structural matches ─────────────────────────────

  await t.step("multiple structural matches → E3012 ambiguous", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E4002", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        diagnostics: [makeDiag({ code: "E4003", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
    ];

    const result = attributeOneOf(childResults, makeContext());

    assertEquals(result.diagnostics[0]!.code, "E3012");
    assertEquals(result.diagnostics[0]!.category, "ambiguous");
    assertEquals(result.structurallyValid, true);
  });

  await t.step(
    "multiple structural matches: includes content diagnostics from matching variants",
    () => {
      const childResults: InterpretResult[] = [
        {
          diagnostics: [
            makeDiag({
              code: "E4002",
              category: "content-note",
              requestPath: "body.a",
            }),
          ],
          structurallyValid: true,
          structuralFailureCount: 0,
        },
        {
          diagnostics: [
            makeDiag({
              code: "E4003",
              category: "content-note",
              requestPath: "body.b",
            }),
          ],
          structurallyValid: true,
          structuralFailureCount: 0,
        },
      ];

      const result = attributeOneOf(childResults, makeContext());

      assertEquals(result.diagnostics.length, 3);
      assertEquals(result.diagnostics[0]!.code, "E3012");
      assertEquals(result.diagnostics[1]!.code, "E4002");
      assertEquals(result.diagnostics[2]!.code, "E4003");
    },
  );

  // ── Case 1: Discriminator ───────────────────────────────────────────

  await t.step("discriminator selects variant by property value", () => {
    const childResults: InterpretResult[] = [
      {
        // Variant 0 (card): has a content error
        diagnostics: [makeDiag({ code: "E4002", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        // Variant 1 (bank): has structural failures
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const schema: Schema = {
      discriminator: { propertyName: "type" },
      oneOf: [
        { properties: { type: { const: "card" } } },
        { properties: { type: { const: "bank" } } },
      ],
    };

    // Request data has type: "card" → selects variant 0
    const result = attributeOneOf(
      childResults,
      makeContext(schema, { type: "card" }),
    );

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.structurallyValid, true);
    assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
  });

  await t.step("discriminator with missing property → E3007", () => {
    const schema: Schema = {
      discriminator: { propertyName: "type" },
      oneOf: [
        { properties: { type: { const: "card" } } },
        { properties: { type: { const: "bank" } } },
      ],
    };

    // Request data has no "type" property
    const result = attributeOneOf(
      [
        {
          diagnostics: [],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
        {
          diagnostics: [],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ],
      makeContext(schema, { name: "Alice" }),
    );

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E3007");
    assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
  });

  await t.step("discriminator with invalid value → E3011", () => {
    const schema: Schema = {
      discriminator: { propertyName: "type" },
      oneOf: [
        { properties: { type: { const: "card" } } },
        { properties: { type: { const: "bank" } } },
      ],
    };

    const result = attributeOneOf(
      [
        {
          diagnostics: [],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
        {
          diagnostics: [],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ],
      makeContext(schema, { type: "crypto" }),
    );

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E3011");
    assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
  });

  await t.step(
    "discriminator with invalid value includes valid values in reasoning",
    () => {
      const schema: Schema = {
        discriminator: { propertyName: "type" },
        oneOf: [
          { properties: { type: { const: "card" } } },
          { properties: { type: { const: "bank" } } },
        ],
      };

      const result = attributeOneOf(
        [
          {
            diagnostics: [],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext(schema, { type: "crypto" }),
      );

      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E3011");
      // Reasoning should include valid values
      const reasoningText = diag.attribution.reasoning.join("\n");
      assertEquals(reasoningText.includes("card"), true);
      assertEquals(reasoningText.includes("bank"), true);
      // Expected should contain valid values
      assertEquals(Array.isArray(diag.expected), true);
      assertEquals((diag.expected as unknown[]).includes("card"), true);
      assertEquals((diag.expected as unknown[]).includes("bank"), true);
    },
  );

  await t.step(
    "discriminator with explicit mapping includes valid values in reasoning",
    () => {
      const schema: Schema = {
        discriminator: {
          propertyName: "type",
          mapping: {
            "cc": "#/components/schemas/CardPayment",
            "ba": "#/components/schemas/BankPayment",
          },
        },
        oneOf: [
          { $ref: "#/components/schemas/CardPayment" },
          { $ref: "#/components/schemas/BankPayment" },
        ],
      };

      const result = attributeOneOf(
        [
          {
            diagnostics: [],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext(schema, { type: "wire" }),
      );

      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E3011");
      const reasoningText = diag.attribution.reasoning.join("\n");
      assertEquals(reasoningText.includes("cc"), true);
      assertEquals(reasoningText.includes("ba"), true);
      assertEquals(Array.isArray(diag.expected), true);
    },
  );

  await t.step("discriminator with explicit mapping", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E4002", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const schema: Schema = {
      discriminator: {
        propertyName: "type",
        mapping: {
          "cc": "#/components/schemas/CardPayment",
          "ba": "#/components/schemas/BankPayment",
        },
      },
      oneOf: [
        { $ref: "#/components/schemas/CardPayment" },
        { $ref: "#/components/schemas/BankPayment" },
      ],
    };

    // "cc" maps to variant 0 (CardPayment)
    const result = attributeOneOf(
      childResults,
      makeContext(schema, { type: "cc" }),
    );

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
  });

  await t.step("discriminator with non-object data → E3007", () => {
    const schema: Schema = {
      discriminator: { propertyName: "type" },
      oneOf: [
        { properties: { type: { const: "card" } } },
      ],
    };

    // data is a string, not an object
    const result = attributeOneOf(
      [{
        diagnostics: [],
        structurallyValid: false,
        structuralFailureCount: 1,
      }],
      makeContext(schema, "not an object"),
    );

    assertEquals(result.diagnostics[0]!.code, "E3007");
  });

  await t.step("discriminator with enum-based variant matching", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E4002", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const schema: Schema = {
      discriminator: { propertyName: "type" },
      oneOf: [
        { properties: { type: { enum: ["card", "credit_card"] } } },
        { properties: { type: { enum: ["bank", "wire"] } } },
      ],
    };

    // "credit_card" matches variant 0's enum
    const result = attributeOneOf(
      childResults,
      makeContext(schema, { type: "credit_card" }),
    );

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
  });
});
