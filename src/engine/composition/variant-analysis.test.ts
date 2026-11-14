import { assertEquals } from "@std/assert";
import { assertInlineSnapshot } from "@std/testing/unstable-snapshot";
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

  await t.step(
    "nullable wrapper: anyOf [X, null] with non-null data attributes to X",
    () => {
      // anyOf: [array, null] with non-null data is the standard nullable
      // pattern. The SDK clearly didn't intend null. The diagnostic should
      // come from the array variant with high confidence, NOT E3012.
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({
                code: "E3008",
                requestPath: "body.files",
                message: "expected array, got string",
              }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({
                code: "E3008",
                requestPath: "body.files",
                message: "expected null, got string",
              }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          path: ["body", "files"],
          schemaPath: "#/properties/files/anyOf",
          schema: {
            anyOf: [
              { type: "array", items: { type: "string", format: "binary" } },
              { type: "null" },
            ],
          },
          // Non-null scalar data: SDK clearly was trying the array variant.
          data: "[File]",
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "Likely variant 0 (only non-null variant)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "expected array, got string",
      requestPath: "body.files",
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

  await t.step(
    "nullable wrapper: oneOf [X, null] with non-null data attributes to X",
    () => {
      // Same pattern with oneOf instead of anyOf.
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected string" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected null" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          schema: {
            oneOf: [
              { type: "string" },
              { type: "null" },
            ],
          },
          data: 42,
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "Likely variant 0 (only non-null variant)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "expected string",
      requestPath: "body",
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

  await t.step(
    "nullable wrapper: null variant first in the list still works",
    () => {
      // The null variant can appear at any position.
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected null" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected array" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          schema: {
            anyOf: [
              { type: "null" },
              { type: "array", items: { type: "string" } },
            ],
          },
          data: "scalar",
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "Likely variant 1 (only non-null variant)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "expected array",
      requestPath: "body",
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

  await t.step(
    "nullable wrapper: multiple non-null variants still use heuristics",
    () => {
      // anyOf [string, integer, null] with boolean data.
      // Null is filtered out, but two real variants remain.
      // Heuristics still apply on the filtered list.
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected string" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected integer" }),
              makeDiag({ code: "E3008", message: "extra failure" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 2,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected null" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          schema: {
            anyOf: [
              { type: "string" },
              { type: "integer" },
              { type: "null" },
            ],
          },
          data: true,
        }),
      );

      // Variant 0 (string) has 1 failure, variant 1 (integer) has 2.
      // After filtering null, the failure-count heuristic picks variant 0.
      // gap=1, confidence = 0.5 + 0.3*(1/2) = 0.65
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
      code: "E3008",
      message: "expected string",
      requestPath: "body",
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

  await t.step(
    "nullable wrapper: real-world Anthropic skills.create files schema",
    () => {
      // Reproduces the exact schema shape that triggered the bug:
      // anyOf: [array of binary, {type: null with extension}]
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({
                code: "E3008",
                requestPath: "body.files",
                message: "expected array",
              }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({
                code: "E3008",
                requestPath: "body.files",
                message: "expected null",
              }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          path: ["body", "files"],
          schemaPath: "#/properties/files",
          schema: {
            anyOf: [
              { items: { type: "string", format: "binary" }, type: "array" },
              { type: "null" },
            ],
            title: "Files",
          },
          // Wire format mismatch produces a scalar where an array was expected.
          data: "[File]",
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "Likely variant 0 (only non-null variant)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "expected array",
      requestPath: "body.files",
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

  await t.step(
    "nullable wrapper: null-only variant with description is still detected",
    () => {
      // Annotation-only fields (description) should not prevent detection.
      const result = analyzeAllFailed(
        [
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected array" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
          {
            diagnostics: [
              makeDiag({ code: "E3008", message: "expected null" }),
            ],
            structurallyValid: false,
            structuralFailureCount: 1,
          },
        ],
        makeContext({
          schema: {
            anyOf: [
              { type: "array", items: { type: "string" } },
              { type: "null", description: "Allows null" },
            ],
          },
          data: "scalar",
        }),
      );

      assertInlineSnapshot(
        result,
        `{
  diagnostics: [
    {
      attribution: {
        confidence: 1,
        reasoning: [
          "Likely variant 0 (only non-null variant)",
          "test",
        ],
      },
      category: "sdk-issue",
      code: "E3008",
      message: "expected array",
      requestPath: "body",
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

Deno.test("analyzeAllFailed: variants that do not accept the type of the value", async (t) => {
  // oneOf [array of integers, integer, object], sent ["x"].
  const insideArray: InterpretResult = {
    diagnostics: [makeDiag({ code: "E3010", requestPath: "body.0" })],
    structurallyValid: false,
    structuralFailureCount: 1,
  };
  const notAnInteger: InterpretResult = {
    diagnostics: [makeDiag({ code: "E3008", message: "expected integer" })],
    structurallyValid: false,
    structuralFailureCount: 1,
    wrongType: true,
  };
  const notAnObject: InterpretResult = {
    diagnostics: [makeDiag({ code: "E3008", message: "expected object" })],
    structurallyValid: false,
    structuralFailureCount: 1,
    wrongType: true,
  };

  await t.step("one variant accepts the type: it is the intended one", () => {
    const result = analyzeAllFailed(
      [notAnInteger, insideArray, notAnObject],
      makeContext({ data: ["x"] }),
    );
    assertEquals(result.diagnostics.map((d) => d.code), ["E3010"]);
    assertEquals(result.diagnostics[0]?.requestPath, "body.0");
    assertEquals(result.diagnostics[0]?.attribution.confidence, 1.0);
    assertEquals(
      result.diagnostics[0]?.attribution.reasoning[0],
      "Likely variant 1 (only variant that accepts the type of the value)",
    );
    assertEquals(result.structurallyValid, false);
  });

  await t.step("several accept the type: only those are compared", () => {
    // A second array variant with more failures inside. The integer
    // variant has the fewest failures of all and must not win.
    const worseArray: InterpretResult = {
      diagnostics: [
        makeDiag({ code: "E3010", requestPath: "body.0" }),
        makeDiag({ code: "E4005", requestPath: "body" }),
        makeDiag({ code: "E3010", requestPath: "body.1" }),
      ],
      structurallyValid: false,
      structuralFailureCount: 2,
    };
    const result = analyzeAllFailed(
      [notAnInteger, worseArray, insideArray],
      makeContext({ data: ["x", "y"] }),
    );
    assertEquals(result.diagnostics.map((d) => d.code), ["E3010"]);
    assertEquals(
      result.diagnostics[0]?.attribution.reasoning[0],
      "Likely variant 2 (fewest structural failures)",
    );
  });

  await t.step("no variant accepts the type: nothing is dropped", () => {
    const result = analyzeAllFailed(
      [notAnInteger, notAnObject],
      makeContext({ data: "text" }),
    );
    assertEquals(result.diagnostics.map((d) => d.code), ["E3012"]);
  });
});
