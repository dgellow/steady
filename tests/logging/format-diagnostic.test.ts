import { assertEquals } from "@std/assert";
import type { Diagnostic } from "../../src/diagnostic.ts";
import {
  formatDiagnostic,
  formatDiagnostics,
  formatDiagnosticSummary,
} from "../../src/logging/format-diagnostic.ts";

/** Helper: create a minimal Diagnostic. */
function diag(
  overrides: Partial<Diagnostic> & { code: string; message: string },
): Diagnostic {
  return {
    severity: "error",
    category: "spec-issue",
    requestPath: "",
    specPointer: "",
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

// ── formatDiagnostic ────────────────────────────────────────────────

Deno.test("formatDiagnostic: minimal diagnostic without display", () => {
  const d = diag({
    code: "E1004",
    message: "Unresolved reference",
    specPointer: "#/paths/~1users/get/responses/200",
    suggestion: "Check that the referenced path exists in the spec",
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(lines[0], "error[E1004]: Unresolved reference");
  assertEquals(lines[1], " --> #/paths/~1users/get/responses/200");
  assertEquals(
    lines[2],
    "  = Check that the referenced path exists in the spec",
  );
});

Deno.test("formatDiagnostic: with display context and highlight", () => {
  const d = diag({
    code: "E1004",
    message: "Unresolved reference",
    specPointer: "#/paths/~1users/get/responses/200",
    suggestion: "Check that the referenced path exists in the spec",
    display: {
      context: [{
        text: "$ref: '#/components/schemas/Ghost'",
        highlight: {
          start: 6,
          end: 6 + "#/components/schemas/Ghost".length + 2,
          label: "Target does not exist",
        },
      }],
    },
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(lines[0], "error[E1004]: Unresolved reference");
  assertEquals(lines[1], " --> #/paths/~1users/get/responses/200");
  assertEquals(lines[2], "  |");
  assertEquals(lines[3], "  |  $ref: '#/components/schemas/Ghost'");
  assertEquals(
    lines[4],
    "  |  " + " ".repeat(6) +
      "^".repeat("#/components/schemas/Ghost".length + 2),
  );
  assertEquals(lines[5], "  |  " + " ".repeat(6) + "Target does not exist");
  assertEquals(lines[6], "  |");
  assertEquals(
    lines[7],
    "  = Check that the referenced path exists in the spec",
  );
});

Deno.test("formatDiagnostic: with display notes", () => {
  const d = diag({
    code: "E1007",
    severity: "warning",
    message: "Keywords [type] alongside $ref are ignored",
    specPointer: "#/paths/~1foo",
    display: {
      context: [{ text: "type" }],
      notes: [
        "In OpenAPI 3.0.3, these keywords are ignored when $ref is present",
      ],
    },
    suggestion: "Move other keywords into the referenced schema",
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(
    lines[0],
    "warning[E1007]: Keywords [type] alongside $ref are ignored",
  );
  assertEquals(lines[1], " --> #/paths/~1foo");
  assertEquals(lines[2], "  |");
  assertEquals(lines[3], "  |  type");
  assertEquals(lines[4], "  |");
  assertEquals(
    lines[5],
    "  = In OpenAPI 3.0.3, these keywords are ignored when $ref is present",
  );
  assertEquals(lines[6], "  = Move other keywords into the referenced schema");
});

Deno.test("formatDiagnostic: no specPointer — omits arrow line", () => {
  const d = diag({
    code: "E1012",
    message: "Impossible constraint",
    specPointer: "",
  });

  const result = formatDiagnostic(d, false);
  assertEquals(result, "error[E1012]: Impossible constraint");
});

Deno.test("formatDiagnostic: context lines without highlight", () => {
  const d = diag({
    code: "E1005",
    severity: "warning",
    message: "Circular reference",
    specPointer: "#/components/schemas/Node",
    display: {
      context: [
        { text: "/components/schemas/Node" },
        { text: "-> /components/schemas/Node/properties/children" },
        { text: "-> /components/schemas/Node (cycle)" },
      ],
    },
    suggestion: "Break the cycle",
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(lines[0], "warning[E1005]: Circular reference");
  assertEquals(lines[1], " --> #/components/schemas/Node");
  assertEquals(lines[2], "  |");
  assertEquals(lines[3], "  |  /components/schemas/Node");
  assertEquals(
    lines[4],
    "  |  -> /components/schemas/Node/properties/children",
  );
  assertEquals(lines[5], "  |  -> /components/schemas/Node (cycle)");
  assertEquals(lines[6], "  |");
  assertEquals(lines[7], "  = Break the cycle");
});

// ── formatDiagnostics ───────────────────────────────────────────────

Deno.test("formatDiagnostics: empty list returns empty string", () => {
  assertEquals(formatDiagnostics([], false), "");
});

Deno.test("formatDiagnostics: groups by severity (errors first)", () => {
  const diagnostics = [
    diag({ code: "E1008", severity: "warning", message: "Duplicate paths" }),
    diag({ code: "E1004", severity: "error", message: "Unresolved ref" }),
    diag({ code: "E1015", severity: "info", message: "Non-standard usage" }),
  ];

  const result = formatDiagnostics(diagnostics, false);

  // Errors should come before warnings before info
  const errorIdx = result.indexOf("error[E1004]");
  const warnIdx = result.indexOf("warning[E1008]");
  const infoIdx = result.indexOf("info[E1015]");

  assertEquals(errorIdx < warnIdx, true);
  assertEquals(warnIdx < infoIdx, true);
});

// ── formatDiagnosticSummary ─────────────────────────────────────────

Deno.test("formatDiagnosticSummary: empty list", () => {
  const result = formatDiagnosticSummary([], false);
  assertEquals(result, "No issues");
});

Deno.test("formatDiagnosticSummary: mixed counts", () => {
  const diagnostics = [
    diag({ code: "E1004", severity: "error", message: "a" }),
    diag({ code: "E1005", severity: "error", message: "b" }),
    diag({ code: "E1008", severity: "warning", message: "c" }),
  ];

  const result = formatDiagnosticSummary(diagnostics, false);
  assertEquals(result, "2 errors, 1 warning");
});

Deno.test("formatDiagnostic: renders expected and actual", () => {
  const d = diag({
    code: "E3007",
    message: "Wrong type",
    specPointer: "#/paths/~1users/post/requestBody",
    expected: "string",
    actual: 12345,
    suggestion: "Send a string value",
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(lines[0], "error[E3007]: Wrong type");
  assertEquals(lines[1], " --> #/paths/~1users/post/requestBody");
  assertEquals(lines[2], "  = expected: string");
  assertEquals(lines[3], "  =   actual: 12345");
  assertEquals(lines[4], "  = Send a string value");
});

Deno.test("formatDiagnostic: renders only actual when expected is absent", () => {
  const d = diag({
    code: "E3007",
    message: "Unexpected value",
    specPointer: "#/foo",
    actual: "oops",
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  assertEquals(lines[2], "  =   actual: oops");
});

Deno.test("formatDiagnostic: expected/actual after notes, before suggestion", () => {
  const d = diag({
    code: "E3007",
    message: "Wrong type",
    specPointer: "#/foo",
    expected: "number",
    actual: "hello",
    suggestion: "Fix it",
    display: {
      notes: ["Schema requires a numeric type"],
    },
  });

  const result = formatDiagnostic(d, false);
  const lines = result.split("\n");

  // notes first
  assertEquals(lines[2], "  = Schema requires a numeric type");
  // then expected/actual
  assertEquals(lines[3], "  = expected: number");
  assertEquals(lines[4], "  =   actual: hello");
  // then suggestion
  assertEquals(lines[5], "  = Fix it");
});

Deno.test("formatDiagnosticSummary: single error", () => {
  const diagnostics = [
    diag({ code: "E1004", severity: "error", message: "a" }),
  ];

  const result = formatDiagnosticSummary(diagnostics, false);
  assertEquals(result, "1 error");
});
