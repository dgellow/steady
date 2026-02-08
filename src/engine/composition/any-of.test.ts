import { assertEquals } from "@std/assert";
import type { CompositionContext, InterpretResult } from "../types.ts";
import type { Diagnostic } from "../../diagnostic.ts";
import { attributeAnyOf } from "./any-of.ts";

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

function makeContext(): CompositionContext {
  return {
    path: "body",
    schemaPath: "#/anyOf",
    schema: {},
    data: {},
  };
}

Deno.test("attributeAnyOf", async (t) => {
  // ── One or more structural matches → success ───────────────────────

  await t.step(
    "one structural match → returns its diagnostics, structurally valid",
    () => {
      const childResults: InterpretResult[] = [
        {
          diagnostics: [
            makeDiag({
              code: "E4002",
              category: "content-note",
              requestPath: "body.name",
            }),
          ],
          structurallyValid: true,
          structuralFailureCount: 0,
        },
        {
          diagnostics: [makeDiag({ code: "E3007", requestPath: "body.email" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const result = attributeAnyOf(childResults, makeContext());

      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E4002");
      assertEquals(result.structurallyValid, true);
      assertEquals(result.structuralFailureCount, 0);
    },
  );

  await t.step(
    "multiple structural matches → merges all matching diagnostics",
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
        {
          diagnostics: [makeDiag({ code: "E3007" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
      ];

      const result = attributeAnyOf(childResults, makeContext());

      // Includes diagnostics from both matching variants, not the failing one
      assertEquals(result.diagnostics.length, 2);
      assertEquals(result.diagnostics[0]!.code, "E4002");
      assertEquals(result.diagnostics[1]!.code, "E4003");
      assertEquals(result.structurallyValid, true);
      assertEquals(result.structuralFailureCount, 0);
    },
  );

  await t.step("structural match with no errors → no diagnostics", () => {
    const childResults: InterpretResult[] = [
      { diagnostics: [], structurallyValid: true, structuralFailureCount: 0 },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = attributeAnyOf(childResults, makeContext());

    assertEquals(result.diagnostics.length, 0);
    assertEquals(result.structurallyValid, true);
  });

  // ── Zero structural matches → same as oneOf ────────────────────────

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

    const result = attributeAnyOf(childResults, makeContext());

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

    const result = attributeAnyOf(childResults, makeContext());

    assertEquals(result.diagnostics[0]!.code, "E3012");
    assertEquals(result.diagnostics[0]!.category, "ambiguous");
    assertEquals(result.structurallyValid, false);
  });
});
