/**
 * Integration test — wires the full diagnostics pipeline end-to-end.
 *
 * Loads a real OpenAPI spec (acme-api), creates the engine from real
 * components (OpenAPISpecDocument, TreeValidator, DiagnosticEngine),
 * and sends crafted requests through analyze().
 *
 * This is the first test that exercises the full pipeline with no mocks.
 */

import { assertEquals } from "@std/assert";
import { parseSpecFromFile } from "@steady/openapi";
import { OpenAPISpecDocument } from "../packages/openapi/document.ts";
import { TreeValidator } from "../packages/json-schema/tree-validator.ts";
import {
  type AnalyzeRequest,
  DiagnosticEngine,
} from "../src/engine/diagnostic-engine.ts";
import type { Diagnostic } from "../src/diagnostic.ts";

/** Load the acme spec once, shared across all tests. */
let engine: DiagnosticEngine;

async function getEngine(): Promise<DiagnosticEngine> {
  if (engine) return engine;

  const spec = await parseSpecFromFile("test-fixtures/acme-api-3.1.yaml");
  const doc = new OpenAPISpecDocument(spec);
  const validator = new TreeValidator({
    resolveRef: (ref) => {
      const schema = doc.resolveSchema(ref);
      return schema;
    },
  });
  engine = new DiagnosticEngine(doc, validator);
  return engine;
}

/** Helper: analyze a request and return diagnostics. */
async function analyze(request: AnalyzeRequest): Promise<Diagnostic[]> {
  const e = await getEngine();
  return e.analyze(request);
}

/** Helper: extract just the codes from diagnostics. */
function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

Deno.test("Diagnostic Integration — Acme API", async (t) => {
  // ── Routing ─────────────────────────────────────────────────────

  await t.step("valid route → no routing errors", async () => {
    const diagnostics = await analyze({
      path: "/status",
      method: "GET",
    });

    // /status GET exists and has no required params or body
    assertEquals(diagnostics.length, 0);
  });

  await t.step("unknown path → E2001", async () => {
    const diagnostics = await analyze({
      path: "/nonexistent",
      method: "GET",
    });

    assertEquals(codes(diagnostics), ["E2001"]);
    assertEquals(diagnostics[0]?.message !== undefined, true);
  });

  await t.step("wrong method → E2002", async () => {
    const diagnostics = await analyze({
      path: "/accounts",
      method: "DELETE",
    });

    assertEquals(codes(diagnostics), ["E2002"]);
  });

  await t.step("path with parameter matches correctly", async () => {
    const diagnostics = await analyze({
      path: "/accounts/abc-123",
      method: "GET",
    });

    // Should match /accounts/{account_id} GET — no errors expected
    assertEquals(diagnostics.length, 0);
  });

  // ── Body validation (requires $ref resolution) ──────────────────

  await t.step(
    "POST /accounts with empty body → missing required 'name'",
    async () => {
      const diagnostics = await analyze({
        path: "/accounts",
        method: "POST",
        body: {},
      });

      // Account schema requires "name".
      // This exercises: body schema $ref resolution → TreeValidator → interpreter
      const requiredErrors = diagnostics.filter((d) => d.code === "E3007");
      assertEquals(requiredErrors.length, 1);
      assertEquals(requiredErrors[0]?.requestPath, "body");
    },
  );

  await t.step("POST /accounts with wrong type → E3008", async () => {
    const diagnostics = await analyze({
      path: "/accounts",
      method: "POST",
      body: { name: 42 },
    });

    const typeErrors = diagnostics.filter((d) => d.code === "E3008");
    assertEquals(typeErrors.length, 1);
  });

  await t.step("POST /accounts with invalid enum → E3016", async () => {
    const diagnostics = await analyze({
      path: "/accounts",
      method: "POST",
      body: { name: "Alice", plan: "INVALID" },
    });

    const enumErrors = diagnostics.filter((d) => d.code === "E3016");
    assertEquals(enumErrors.length, 1);
  });

  await t.step("POST /accounts with valid body → no errors", async () => {
    const diagnostics = await analyze({
      path: "/accounts",
      method: "POST",
      body: { name: "Alice", plan: "FREE" },
    });

    assertEquals(diagnostics.length, 0);
  });

  // ── Nested $ref resolution ──────────────────────────────────────

  await t.step(
    "POST /accounts with invalid nested address → errors at nested path",
    async () => {
      // Account.address → $ref: "#/components/schemas/Address"
      // Address requires: address1, city, country, postal_code, state
      const diagnostics = await analyze({
        path: "/accounts",
        method: "POST",
        body: {
          name: "Alice",
          address: { city: 123 },
        },
      });

      // Should have: missing required fields + type error on city
      const requiredErrors = diagnostics.filter((d) => d.code === "E3007");
      const typeErrors = diagnostics.filter((d) => d.code === "E3008");

      // Missing: address1, country, postal_code, state (4 required fields)
      assertEquals(requiredErrors.length, 4);
      // city should be string but got number
      assertEquals(typeErrors.length, 1);
      assertEquals(typeErrors[0]?.requestPath, "body.address.city");
    },
  );

  // ── oneOf with discriminator ────────────────────────────────────

  await t.step(
    "POST /accounts/{id}/link with valid google link → no errors",
    async () => {
      const diagnostics = await analyze({
        path: "/accounts/abc-123/link",
        method: "POST",
        body: { type: "google", google_account_id: "12345" },
      });

      assertEquals(diagnostics.length, 0);
    },
  );

  await t.step(
    "POST /accounts/{id}/link with wrong variant data → errors",
    async () => {
      // Sends google type but with facebook fields (missing google_account_id)
      const diagnostics = await analyze({
        path: "/accounts/abc-123/link",
        method: "POST",
        body: { type: "google", facebook_account_id: "12345" },
      });

      // Should have errors — missing google_account_id from the google variant
      assertEquals(diagnostics.length > 0, true);
    },
  );

  // ── Multiple diagnostic types in one request ────────────────────

  await t.step("multiple errors: wrong type + invalid enum", async () => {
    const diagnostics = await analyze({
      path: "/accounts",
      method: "POST",
      body: { name: 42, plan: "INVALID", state: "UNKNOWN" },
    });

    const typeCodes = diagnostics.filter((d) => d.code === "E3008");
    const enumCodes = diagnostics.filter((d) => d.code === "E3016");

    // name: wrong type, plan: invalid enum, state: invalid enum
    assertEquals(typeCodes.length, 1);
    assertEquals(enumCodes.length, 2);
  });
});
