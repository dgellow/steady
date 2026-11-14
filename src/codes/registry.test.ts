/**
 * The registry decides what a diagnostic means for the request that caused
 * it. A code whose category is `sdk-issue` rejects the request with 400.
 * Every other category lets it through. A wrong category is therefore
 * either a valid request rejected, or an SDK bug waved through.
 *
 * This table is written out by hand on purpose. Changing what a code means
 * has to be a visible edit here, next to the change in the registry.
 */

import { assertEquals } from "@std/assert";
import { allCodes } from "./registry.ts";

/** `category/severity`, with `/fatal` when the spec cannot be served. */
const EXPECTED: Record<string, string[]> = {
  // Startup: the spec cannot be loaded.
  "spec-issue/error/fatal": ["E1001", "E1002", "E1004", "E1006"],
  // Startup: the spec is served, something in it is wrong.
  "spec-issue/error": ["E1012", "E1019", "E1022", "E1023"],
  "spec-issue/warning": [
    "E1003",
    "E1005",
    "E1007",
    "E1008",
    "E1009",
    "E1010",
    "E1011",
    "E1013",
    "E1014",
    "E1016",
    "E1017",
    "E1018",
    "E1020",
    "E1021",
  ],
  "spec-issue/info": ["E1015", "E1024"],

  // Request: the SDK sent it wrong. These reject.
  "sdk-issue/error": [
    "E2001",
    "E2002",
    "E3001",
    "E3002",
    "E3003",
    "E3004",
    "E3005",
    "E3006",
    "E3007",
    "E3008",
    "E3009",
    "E3010",
    "E3011",
    "E3016",
    "E3017",
    "E3018",
    "E3019",
    "E3020",
    "E3021",
  ],
  "sdk-issue/warning": ["E3014", "E3022", "E3023"],

  // Request: Steady cannot tell whose fault it is. These do not reject.
  "ambiguous/warning": ["E3012", "E3013", "E5001", "E5003"],
  "ambiguous/info": ["E3015"],

  // Request: the transport is right, the content is not. These do not
  // reject.
  "content-note/info": ["E4001", "E4002", "E4003", "E4004", "E4005", "E4007"],
};

Deno.test("registry: category, severity and fatal of every code", () => {
  const actual: Record<string, string[]> = {};
  for (const [code, definition] of Object.entries(allCodes())) {
    const key = `${definition.category}/${definition.severity}${
      definition.fatal ? "/fatal" : ""
    }`;
    (actual[key] ??= []).push(code);
  }
  for (const codes of Object.values(actual)) codes.sort();

  const sorted = (table: Record<string, string[]>) =>
    Object.fromEntries(
      Object.keys(table).sort().map((key) => [key, table[key]]),
    );
  assertEquals(sorted(actual), sorted(EXPECTED));
});

Deno.test("registry: only request diagnostics about the transport reject", () => {
  const rejecting = Object.entries(allCodes())
    .filter(([, definition]) => definition.category === "sdk-issue")
    .map(([code]) => code);

  // Routing (E2xxx) and structural request validation (E3xxx), nothing else.
  for (const code of rejecting) {
    assertEquals(/^E[23]\d{3}$/.test(code), true, `${code} rejects`);
  }
  // No startup diagnostic and no content note can reject a request.
  for (const [code, definition] of Object.entries(allCodes())) {
    if (/^E[145]/.test(code)) {
      assertEquals(
        definition.category === "sdk-issue",
        false,
        `${code} must not reject a request`,
      );
    }
  }
});

Deno.test("registry: fatal is only used for startup codes", () => {
  for (const [code, definition] of Object.entries(allCodes())) {
    if (definition.fatal) {
      assertEquals(code.startsWith("E1"), true, `${code} is fatal`);
    }
  }
});
