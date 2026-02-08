import { assertEquals } from "@std/assert";
import type { CompositionContext, InterpretResult } from "../types.ts";
import type { Diagnostic } from "../../diagnostic.ts";
import { analyzeAllFailed } from "./variant-analysis.ts";

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
    schemaPath: "#/oneOf",
    schema: {},
    data: {},
  };
}

Deno.test("analyzeAllFailed", async (t) => {
  await t.step(
    "one variant has fewer structural failures → identifies it as likely",
    () => {
      const childResults: InterpretResult[] = [
        {
          // Variant 0: 1 structural failure
          diagnostics: [makeDiag({ code: "E3007", requestPath: "body.file" })],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
        {
          // Variant 1: 3 structural failures
          diagnostics: [
            makeDiag({ code: "E3007", requestPath: "body.url" }),
            makeDiag({ code: "E3007", requestPath: "body.account" }),
            makeDiag({ code: "E3008", requestPath: "body.name" }),
          ],
          structurallyValid: false,
          structuralFailureCount: 3,
        },
      ];

      const result = analyzeAllFailed(childResults, makeContext());

      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E3007");
      assertEquals(result.diagnostics[0]!.requestPath, "body.file");
      assertEquals(result.structurallyValid, false);
      assertEquals(
        result.diagnostics[0]!.attribution.reasoning[0],
        "Likely variant 0 (fewest structural failures)",
      );
    },
  );

  await t.step("equal structural failures → E3012 ambiguous", () => {
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

    const result = analyzeAllFailed(childResults, makeContext());

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E3012");
    assertEquals(result.diagnostics[0]!.category, "ambiguous");
    assertEquals(result.structurallyValid, false);
  });

  await t.step("E3012 uses context path and schemaPath", () => {
    const context: CompositionContext = {
      path: "body.payment",
      schemaPath: "#/components/schemas/Payment/oneOf",
      schema: {},
      data: {},
    };

    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = analyzeAllFailed(childResults, context);

    assertEquals(result.diagnostics[0]!.requestPath, "body.payment");
    assertEquals(
      result.diagnostics[0]!.specPointer,
      "#/components/schemas/Payment/oneOf",
    );
  });

  await t.step("E3012 includes per-variant details in reasoning", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
      {
        diagnostics: [makeDiag({ code: "E3007" })],
        structurallyValid: false,
        structuralFailureCount: 1,
      },
    ];

    const result = analyzeAllFailed(childResults, makeContext());

    const reasoning = result.diagnostics[0]!.attribution.reasoning;
    assertEquals(reasoning.length, 2);
    assertEquals(reasoning[0]!.startsWith("Variant 0:"), true);
    assertEquals(reasoning[1]!.startsWith("Variant 1:"), true);
  });

  await t.step("single variant → returns its diagnostics", () => {
    const childResults: InterpretResult[] = [
      {
        diagnostics: [
          makeDiag({ code: "E3007", requestPath: "body.file" }),
          makeDiag({ code: "E3008", requestPath: "body.name" }),
        ],
        structurallyValid: false,
        structuralFailureCount: 2,
      },
    ];

    const result = analyzeAllFailed(childResults, makeContext());

    assertEquals(result.diagnostics.length, 2);
    assertEquals(result.structurallyValid, false);
  });

  await t.step("uses structuralFailureCount, not diagnostic category", () => {
    // Variant 0: 1 structural failure but 3 diagnostics (2 are content/ambiguous)
    // Variant 1: 2 structural failures
    // If we counted by category, variant 0 might look worse. But structuralFailureCount is correct.
    const childResults: InterpretResult[] = [
      {
        diagnostics: [
          makeDiag({ code: "E3007" }),
          makeDiag({ code: "E5001", category: "ambiguous" }), // ambiguous, but type=structural
          makeDiag({ code: "E4002", category: "content-note" }),
        ],
        structurallyValid: false,
        structuralFailureCount: 1, // Only 1 structural failure despite 3 diagnostics
      },
      {
        diagnostics: [
          makeDiag({ code: "E3007" }),
          makeDiag({ code: "E3008" }),
        ],
        structurallyValid: false,
        structuralFailureCount: 2,
      },
    ];

    const result = analyzeAllFailed(childResults, makeContext());

    // Variant 0 has fewer structural failures (1 vs 2)
    assertEquals(result.diagnostics.length, 3); // variant 0's diagnostics
    assertEquals(result.structurallyValid, false);
  });
});
