import { assertEquals } from "@std/assert";
import type { Schema } from "@steady/json-schema";
import type { CompositionContext, InterpretResult } from "../types.ts";
import type { Diagnostic } from "../../diagnostic.ts";
import { attributeAllOf } from "./all-of.ts";

function makeDiag(
  overrides: Partial<Diagnostic> & { code: string },
): Diagnostic {
  return {
    severity: "error",
    category: "sdk-issue",
    requestPath: "body",
    specPointer: "#/test",
    message: "test",
    attribution: { confidence: 0.9, reasoning: ["test"] },
    ...overrides,
  };
}

function makeContext(schema: Schema): CompositionContext {
  return {
    path: "body",
    schemaPath: "#/allOf",
    schema,
    data: {},
  };
}

Deno.test("attributeAllOf", async (t) => {
  // ── Basic merge behavior ────────────────────────────────────────────

  await t.step("merges all children's diagnostics", () => {
    const children: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007", requestPath: "body.name" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [
          makeDiag({
            code: "E4002",
            category: "content-note",
            requestPath: "body.role",
          }),
        ],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
    ];

    const result = attributeAllOf(children, makeContext({}));

    assertEquals(result.diagnostics.length, 2);
    assertEquals(result.diagnostics[0]!.code, "E3007");
    assertEquals(result.diagnostics[1]!.code, "E4002");
  });

  await t.step("structurallyValid is AND of all children", () => {
    const allValid: InterpretResult[] = [
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
    assertEquals(
      attributeAllOf(allValid, makeContext({})).structurallyValid,
      true,
    );

    const oneInvalid: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E4002", category: "content-note" })],
        structurallyValid: true,
        structuralFailureCount: 0,
      },
      {
        diagnostics: [makeDiag({ code: "E3008" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];
    assertEquals(
      attributeAllOf(oneInvalid, makeContext({})).structurallyValid,
      false,
    );
  });

  await t.step("structuralFailureCount is sum of children", () => {
    const children: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [makeDiag({ code: "E3008" })],
        structurallyValid: false,
        structuralFailureCount: 2,
      },
    ];

    const result = attributeAllOf(children, makeContext({}));
    assertEquals(result.structuralFailureCount, 3);
  });

  await t.step("empty children → structurally valid, zero failures", () => {
    const result = attributeAllOf([], makeContext({}));
    assertEquals(result.diagnostics, []);
    assertEquals(result.structurallyValid, true);
    assertEquals(result.structuralFailureCount, 0);
  });

  // ── additionalProperties pitfall ────────────────────────────────────

  await t.step(
    "re-attributes E3009 to spec-issue when property exists in sibling allOf member",
    () => {
      const children: InterpretResult[] = [
        {
          diagnostics: [makeDiag({
            code: "E3009",
            requestPath: "body.name",
            actual: "name",
          })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const schema: Schema = {
        allOf: [
          {
            properties: { name: { type: "string" }, email: { type: "string" } },
          },
          {
            properties: { role: { type: "string" } },
            additionalProperties: false,
          },
        ],
      };

      const result = attributeAllOf(children, makeContext(schema));

      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E3009");
      assertEquals(result.diagnostics[0]!.category, "spec-issue");
      assertEquals(
        result.diagnostics[0]!.attribution.reasoning[0],
        "allOf + additionalProperties pitfall",
      );
      assertEquals(
        result.diagnostics[0]!.suggestion,
        "Use unevaluatedProperties instead of additionalProperties in allOf",
      );
    },
  );

  await t.step(
    "does NOT re-attribute E3009 when property doesn't exist in any sibling",
    () => {
      const children: InterpretResult[] = [
        {
          diagnostics: [makeDiag({
            code: "E3009",
            requestPath: "body.unknown",
            actual: "unknown",
          })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const schema: Schema = {
        allOf: [
          { properties: { name: { type: "string" } } },
          {
            properties: { role: { type: "string" } },
            additionalProperties: false,
          },
        ],
      };

      const result = attributeAllOf(children, makeContext(schema));

      assertEquals(result.diagnostics[0]!.category, "sdk-issue");
    },
  );

  await t.step("does NOT re-attribute when allOf has only one member", () => {
    const children: InterpretResult[] = [
      {
        diagnostics: [makeDiag({
          code: "E3009",
          actual: "name",
        })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const schema: Schema = {
      allOf: [
        {
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
      ],
    };

    const result = attributeAllOf(children, makeContext(schema));

    assertEquals(result.diagnostics[0]!.category, "sdk-issue");
  });

  // ── Contradictory types (impossible schema) ─────────────────────────

  await t.step("detects contradictory type constraints → E1012", () => {
    const children: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3008" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const schema: Schema = {
      allOf: [
        { type: "string" },
        { type: "number" },
      ],
    };

    const result = attributeAllOf(children, makeContext(schema));

    assertEquals(result.diagnostics[0]!.code, "E1012");
    assertEquals(result.diagnostics[0]!.category, "spec-issue");
    assertEquals(result.structurallyValid, false);
  });

  await t.step(
    "does NOT flag contradictory types when types are the same",
    () => {
      const children: InterpretResult[] = [
        {
          diagnostics: [makeDiag({ code: "E3007" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const schema: Schema = {
        allOf: [
          { type: "object" },
          { type: "object" },
        ],
      };

      const result = attributeAllOf(children, makeContext(schema));

      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E3007");
    },
  );

  await t.step(
    "contradictory types: includes child diagnostics after E1012",
    () => {
      const children: InterpretResult[] = [
        {
          diagnostics: [makeDiag({ code: "E3008", requestPath: "body.value" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
        {
          diagnostics: [makeDiag({ code: "E3008", requestPath: "body.value" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const schema: Schema = {
        allOf: [
          { type: "string" },
          { type: "number" },
        ],
      };

      const result = attributeAllOf(children, makeContext(schema));

      assertEquals(result.diagnostics[0]!.code, "E1012");
      assertEquals(result.diagnostics.length, 3);
    },
  );
});
