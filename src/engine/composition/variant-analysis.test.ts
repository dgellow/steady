import { assertInlineSnapshot } from "@std/testing/unstable-snapshot";
import type { CompositionContext } from "../types.ts";
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
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

function makeContext(
  overrides?: Partial<CompositionContext>,
): CompositionContext {
  return {
    path: ["body"],
    schemaPath: "#/oneOf",
    schema: {},
    data: {},
    ...overrides,
  };
}

Deno.test("analyzeAllFailed", async (t) => {
  await t.step(
    "one variant has fewer structural failures → identifies it as likely",
    () => {
      // 1 vs 3 failures: gap=2, confidence = 0.5 + 0.3*(2/3) ≈ 0.7
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3007", requestPath: "body.file" }),
            ],
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
        ],
        makeContext(),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 0.7,
        reasoning: [
          "Likely variant 0 (fewest structural failures)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3007",
      message: "test",
      requestPath: "body.file",
      severity: "error",
      specPointer: "#/test",
    },
  ],
  structuralFailureCount: 1,
  structurallyValid: false,
}`,
      );
    },
  );

  await t.step("equal structural failures → E3012 ambiguous", () => {
    const result = analyzeAllFailed(
      [
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
      ],
      makeContext(),
    );

    assertInlineSnapshot(
      result,
      `{
  diagnostics: [
    {
      attribution: {
        confidence: 0.5,
        reasoning: [
          "Variant 0: 1 structural failure(s), 1 total",
          "Variant 1: 1 structural failure(s), 1 total",
        ],
      },
      category: "ambiguous",
      code: "E3012",
      message: "No variant matched: 2 variants all failed structurally",
      requestPath: "body",
      severity: "warning",
      specPointer: "#/oneOf",
    },
  ],
  structuralFailureCount: 0,
  structurallyValid: false,
}`,
    );
  });

  await t.step("E3012 uses context path and schemaPath", () => {
    const result = analyzeAllFailed(
      [
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
      ],
      makeContext({
        path: ["body", "payment"],
        schemaPath: "#/components/schemas/Payment/oneOf",
      }),
    );

    assertInlineSnapshot(
      result,
      `{
  diagnostics: [
    {
      attribution: {
        confidence: 0.5,
        reasoning: [
          "Variant 0: 1 structural failure(s), 1 total",
          "Variant 1: 1 structural failure(s), 1 total",
        ],
      },
      category: "ambiguous",
      code: "E3012",
      message: "No variant matched: 2 variants all failed structurally",
      requestPath: "body.payment",
      severity: "warning",
      specPointer: "#/components/schemas/Payment/oneOf",
    },
  ],
  structuralFailureCount: 0,
  structurallyValid: false,
}`,
    );
  });

  await t.step("single variant → returns its diagnostics", () => {
    const result = analyzeAllFailed(
      [
        {
          diagnostics: [
            makeDiag({ code: "E3007", requestPath: "body.file" }),
            makeDiag({ code: "E3008", requestPath: "body.name" }),
          ],
          structurallyValid: false,
          structuralFailureCount: 2,
        },
      ],
      makeContext(),
    );

    assertInlineSnapshot(
      result,
      `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3007",
      message: "test",
      requestPath: "body.file",
      severity: "error",
      specPointer: "#/test",
    },
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "test",
      requestPath: "body.name",
      severity: "error",
      specPointer: "#/test",
    },
  ],
  structuralFailureCount: 2,
  structurallyValid: false,
}`,
    );
  });

  await t.step(
    "property overlap identifies variant when failure counts are equal",
    () => {
      // CardPayment has card_number, BankPayment has account_number.
      // Request has card_number → overlap identifies CardPayment.
      // Both have 1 structural failure, so failure count alone is ambiguous.
      // 1 key exclusive to variant 0: confidence = 0.5 + 0.4*(1/1) = 0.9
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3007", requestPath: "body.expiry" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3007", requestPath: "body.routing" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          schema: {
            oneOf: [
              {
                type: "object",
                properties: {
                  card_number: { type: "string" },
                  expiry: { type: "string" },
                },
              },
              {
                type: "object",
                properties: {
                  account_number: { type: "string" },
                  routing: { type: "string" },
                },
              },
            ],
          },
          data: { card_number: "4111111111111111" },
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 0.9,
        reasoning: [
          "Likely variant 0 (property overlap)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3007",
      message: "test",
      requestPath: "body.expiry",
      severity: "error",
      specPointer: "#/test",
    },
  ],
  structuralFailureCount: 1,
  structurallyValid: false,
}`,
      );
    },
  );

  await t.step("uses structuralFailureCount, not diagnostic category", () => {
    // Variant 0: 1 structural failure but 3 diagnostics (2 are content/ambiguous)
    // Variant 1: 2 structural failures
    // 1 vs 2 failures: gap=1, confidence = 0.5 + 0.3*(1/2) = 0.65
    const result = analyzeAllFailed(
      [
        {
          diagnostics: [
            makeDiag({ code: "E3007" }),
            makeDiag({ code: "E5001", category: "ambiguous" }),
            makeDiag({ code: "E4002", category: "content-note" }),
          ],
          structurallyValid: false,
          structuralFailureCount: 1,
        },
        {
          diagnostics: [
            makeDiag({ code: "E3007" }),
            makeDiag({ code: "E3008" }),
          ],
          structurallyValid: false,
          structuralFailureCount: 2,
        },
      ],
      makeContext(),
    );

    assertInlineSnapshot(
      result,
      `{
  diagnostics: [
    {
      attribution: {
        confidence: 0.65,
        reasoning: [
          "Likely variant 0 (fewest structural failures)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3007",
      message: "test",
      requestPath: "body",
      severity: "error",
      specPointer: "#/test",
    },
    {
      attribution: {
        confidence: 0.65,
        reasoning: [
          "Likely variant 0 (fewest structural failures)",
          "test",
        ],
      },
      category: "ambiguous",
      code: "E5001",
      message: "test",
      requestPath: "body",
      severity: "error",
      specPointer: "#/test",
    },
    {
      attribution: {
        confidence: 0.65,
        reasoning: [
          "Likely variant 0 (fewest structural failures)",
          "test",
        ],
      },
      category: "content-note",
      code: "E4002",
      message: "test",
      requestPath: "body",
      severity: "error",
      specPointer: "#/test",
    },
  ],
  structuralFailureCount: 1,
  structurallyValid: false,
}`,
    );
  });
});
