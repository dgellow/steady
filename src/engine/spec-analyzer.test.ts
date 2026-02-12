import { assertEquals } from "@std/assert";
import type { OpenAPISpec } from "@steady/openapi";
import type { Diagnostic } from "../diagnostic.ts";
import { analyzeSpec } from "./spec-analyzer.ts";

// ── Test helpers ────────────────────────────────────────────────────

/** Minimal valid OpenAPI 3.0 spec — no diagnostics expected. */
function minimalSpec(overrides?: Partial<OpenAPISpec>): OpenAPISpec {
  return {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
    ...overrides,
  };
}

/** Filter diagnostics by code, assert exactly `n`, return them. */
function filterCode(
  diagnostics: Diagnostic[],
  code: string,
  expectedCount: number,
): Diagnostic[] {
  const filtered = diagnostics.filter((d) => d.code === code);
  assertEquals(
    filtered.length,
    expectedCount,
    `Expected ${expectedCount} ${code} diagnostic(s), got ${filtered.length}: ${
      JSON.stringify(filtered.map((d) => d.message))
    }`,
  );
  return filtered;
}

/** Get the single diagnostic matching code, asserting exactly 1 exists. */
function singleDiag(diagnostics: Diagnostic[], code: string): Diagnostic {
  const results = filterCode(diagnostics, code, 1);
  return results[0] ?? unreachable();
}

function unreachable(): never {
  throw new Error("unreachable");
}

// ── Skeleton ────────────────────────────────────────────────────────

Deno.test("analyzeSpec — clean spec produces no diagnostics", async () => {
  const result = await analyzeSpec(minimalSpec());
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.fatal, false);
});

// ── E1013: Multiple question marks in path ──────────────────────────

Deno.test("E1013 — detects multiple question marks in path", async () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1?page=2": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1013");
  assertEquals(d.severity, "warning");
  assertEquals(d.category, "spec-issue");
  assertEquals(d.requestPath, "");
  assertEquals(d.specPointer, "#/paths/~1search?q=1?page=2");
});

Deno.test("E1013 — single question mark is fine", async () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1013", 0);
});

// ── E1014: Question mark in parameter name/enum ─────────────────────

Deno.test("E1014 — detects question mark in parameter name", async () => {
  const spec = minimalSpec({
    paths: {
      "/search": {
        get: {
          parameters: [
            { name: "q?", in: "query" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1014");
  assertEquals(d.message.includes("q?"), true);
});

Deno.test("E1014 — detects question mark in enum value", async () => {
  const spec = minimalSpec({
    paths: {
      "/filter": {
        get: {
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { enum: ["active", "inactive?"] },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1014");
  assertEquals(d.message.includes("inactive?"), true);
});

Deno.test("E1014 — resolves $ref parameters", async () => {
  const spec = minimalSpec({
    paths: {
      "/search": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/BadParam" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      parameters: {
        BadParam: { name: "q?filter", in: "query" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1014", 1);
});

Deno.test("E1014 — path-level parameters are checked", async () => {
  const spec = minimalSpec({
    paths: {
      "/search": {
        parameters: [
          { name: "x?y", in: "query" },
        ],
        get: {
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1014", 1);
});

// ── E1008: Duplicate path patterns ──────────────────────────────────

Deno.test("E1008 — detects duplicate path patterns", async () => {
  const spec = minimalSpec({
    paths: {
      "/users/{userId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/users/{id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1008"); // One per conflict group
  assertEquals(d.message.includes("/users/{userId}"), true);
  assertEquals(d.message.includes("/users/{id}"), true);
});

Deno.test("E1008 — no false positive for different structures", async () => {
  const spec = minimalSpec({
    paths: {
      "/users/{userId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/users/{userId}/posts": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1008", 0);
});

// ── E1009: Duplicate path parameter names ───────────────────────────

Deno.test("E1009 — detects duplicate parameter names in path", async () => {
  const spec = minimalSpec({
    paths: {
      "/users/{id}/posts/{id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1009");
  assertEquals(d.message.includes("{id}"), true);
});

Deno.test("E1009 — unique parameter names are fine", async () => {
  const spec = minimalSpec({
    paths: {
      "/users/{userId}/posts/{postId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1009", 0);
});

// ── E1010: Missing responses ────────────────────────────────────────

Deno.test("E1010 — detects operation with empty responses", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: { responses: {} },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1010");
  assertEquals(d.message.includes("GET /users"), true);
});

Deno.test("E1010 — operation with responses is fine", async () => {
  const result = await analyzeSpec(minimalSpec());
  filterCode(result.diagnostics, "E1010", 0);
});

// ── E1011: Invalid component names ──────────────────────────────────

Deno.test("E1011 — detects invalid component name", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        "Valid-Name.v1": { type: "object" },
        "Invalid Name": { type: "object" },
        "also/invalid": { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1011", 2); // "Invalid Name" and "also/invalid"
});

Deno.test("E1011 — valid component names are fine", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        "UserResponse": { type: "object" },
        "user-response": { type: "object" },
        "user.response.v1": { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1011", 0);
});

// ── E1007: Keywords alongside $ref (3.0.x) ─────────────────────────

Deno.test("E1007 — detects keywords alongside $ref in 3.0.x", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/User",
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1007");
  assertEquals(d.message.includes("nullable"), true);
});

Deno.test("E1007 — summary/description alongside $ref are ignored", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/User",
                    description: "A user object",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

Deno.test("E1007 — no warning for webhook schemas", async () => {
  const spec = minimalSpec({
    webhooks: {
      "card.created": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Event", type: "object" },
                  ],
                },
              },
            },
          },
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        Event: { type: "object" },
      },
    },
  } as Partial<OpenAPISpec>);

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

Deno.test("E1007 — no warning for 3.1.x specs", async () => {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/User",
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  };

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

// ── E1004: Unresolved $ref ──────────────────────────────────────────

Deno.test("E1004 — detects unresolved $ref", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DoesNotExist" },
                },
              },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1004", 1);
  assertEquals(result.fatal, true);
});

Deno.test("E1004 — valid $ref produces no diagnostic", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1004", 0);
});

// ── E1005: Circular $ref ────────────────────────────────────────────

Deno.test("E1005 — suppresses cycle through optional property", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Node: {
          type: "object",
          properties: {
            child: { $ref: "#/components/schemas/Node" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — suppresses indirect cycle through optional properties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        A: {
          type: "object",
          properties: {
            b: { $ref: "#/components/schemas/B" },
          },
        },
        B: {
          type: "object",
          properties: {
            a: { $ref: "#/components/schemas/A" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — non-circular refs are fine", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            address: { $ref: "#/components/schemas/Address" },
          },
        },
        Address: { type: "object" },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — detects forced self-reference (required property)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Infinite: {
          type: "object",
          required: ["next"],
          properties: {
            next: { $ref: "#/components/schemas/Infinite" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const e1005 = result.diagnostics.filter((d) => d.code === "E1005");
  assertEquals(e1005.length >= 1, true);
});

Deno.test("E1005 — detects forced indirect cycle (all edges required)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        A: {
          type: "object",
          required: ["b"],
          properties: {
            b: { $ref: "#/components/schemas/B" },
          },
        },
        B: {
          type: "object",
          required: ["a"],
          properties: {
            a: { $ref: "#/components/schemas/A" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const e1005 = result.diagnostics.filter((d) => d.code === "E1005");
  assertEquals(e1005.length >= 1, true);
});

Deno.test("E1005 — suppresses cycle through array items", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        TreeNode: {
          type: "object",
          required: ["children"],
          properties: {
            children: {
              type: "array",
              items: { $ref: "#/components/schemas/TreeNode" },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — suppresses cycle through oneOf alternative", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Expression: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              required: ["left", "right"],
              properties: {
                left: { $ref: "#/components/schemas/Expression" },
                right: { $ref: "#/components/schemas/Expression" },
              },
            },
          ],
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — mixed: forced + optional edge → suppressed", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        A: {
          type: "object",
          required: ["b"],
          properties: {
            b: { $ref: "#/components/schemas/B" },
          },
        },
        B: {
          type: "object",
          properties: {
            a: { $ref: "#/components/schemas/A" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

// ── E1012: Impossible schema constraints ────────────────────────────

Deno.test("E1012 — detects minimum > maximum", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", minimum: 10, maximum: 5 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("minimum"), true);
});

Deno.test("E1012 — detects minLength > maxLength", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "string", minLength: 10, maxLength: 5 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects minItems > maxItems", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          type: "array",
          items: { type: "string" },
          minItems: 5,
          maxItems: 2,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects minProperties > maxProperties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "object", minProperties: 5, maxProperties: 2 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects required > maxProperties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          type: "object",
          required: ["a", "b", "c"],
          maxProperties: 2,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects empty enum", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "string", enum: [] },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects conflicting allOf types", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { type: "string" },
            { type: "number" },
          ],
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("conflicting types"), true);
});

Deno.test("E1012 — valid constraints produce no diagnostic", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          type: "object",
          required: ["a"],
          maxProperties: 5,
          properties: {
            a: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: inline schemas ───────────────────────────────────────────

Deno.test("E1012 — detects impossible constraints in inline request body schema", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "string", minLength: 10, maxLength: 5 },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 — detects impossible constraints in inline response schema", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      age: { type: "number", minimum: 100, maximum: 10 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── Fatal flag ──────────────────────────────────────────────────────

Deno.test("analyzeSpec — fatal flag is true when E1004 is present", async () => {
  const spec = minimalSpec({
    paths: {
      "/bad": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Nope" },
                },
              },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  assertEquals(result.fatal, true);
});

Deno.test("analyzeSpec — fatal flag is false for warnings only", async () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1?page=2": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = await analyzeSpec(spec);
  assertEquals(result.fatal, false);
  assertEquals(result.diagnostics.length > 0, true);
});

// ── E1005: 3-node cycle ─────────────────────────────────────────────

Deno.test("E1005 — suppresses 3-node cycle through optional properties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        A: {
          type: "object",
          properties: { b: { $ref: "#/components/schemas/B" } },
        },
        B: {
          type: "object",
          properties: { c: { $ref: "#/components/schemas/C" } },
        },
        C: {
          type: "object",
          properties: { a: { $ref: "#/components/schemas/A" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 — suppresses multiple independent optional cycles", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        // Cycle 1: X ↔ Y (both optional)
        X: {
          type: "object",
          properties: { y: { $ref: "#/components/schemas/Y" } },
        },
        Y: {
          type: "object",
          properties: { x: { $ref: "#/components/schemas/X" } },
        },
        // Cycle 2: P ↔ Q (both optional)
        P: {
          type: "object",
          properties: { q: { $ref: "#/components/schemas/Q" } },
        },
        Q: {
          type: "object",
          properties: { p: { $ref: "#/components/schemas/P" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

// ── E1004: external refs are ignored ────────────────────────────────

Deno.test("E1004 — external refs (non-#) are not flagged as unresolved", async () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "other-file.yaml#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const e1004 = result.diagnostics.filter((d) => d.code === "E1004");
  assertEquals(e1004.length, 0);
});

// ── E1012: exclusive bounds (numeric — 3.1.x style) ─────────────────

Deno.test("E1012 — detects exclusiveMinimum >= maximum (numeric)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", exclusiveMinimum: 10, maximum: 10 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
});

Deno.test("E1012 — detects minimum >= exclusiveMaximum (numeric)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", minimum: 10, exclusiveMaximum: 10 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 — detects exclusiveMinimum >= exclusiveMaximum (numeric)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", exclusiveMinimum: 5, exclusiveMaximum: 5 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 — valid exclusive bounds produce no diagnostic (numeric)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: exclusive bounds (boolean — 3.0.x style) ─────────────────

Deno.test("E1012 — detects min == max with exclusiveMinimum: true (boolean)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          type: "number",
          minimum: 10,
          maximum: 10,
          exclusiveMinimum: true,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
});

Deno.test("E1012 — detects min == max with exclusiveMaximum: true (boolean)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          type: "number",
          minimum: 10,
          maximum: 10,
          exclusiveMaximum: true,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 — min < max with exclusiveMinimum: true is fine (boolean)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          type: "number",
          minimum: 5,
          maximum: 10,
          exclusiveMinimum: true,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: inline parameter schemas ─────────────────────────────────

Deno.test("E1012 — detects impossible constraint in inline parameter schema", async () => {
  const spec = minimalSpec({
    paths: {
      "/search": {
        get: {
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 100, maximum: 10 },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1012: path-level parameter schemas ─────────────────────────────

Deno.test("E1012 — detects impossible constraint in path-level parameter schema", async () => {
  const spec = minimalSpec({
    paths: {
      "/items": {
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 50, maximum: 5 },
          },
        ],
        get: {
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1012: nested property schemas ──────────────────────────────────

Deno.test("E1012 — detects impossible constraint in deeply nested schema", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Outer: {
          type: "object",
          properties: {
            inner: {
              type: "object",
              properties: {
                deep: { type: "string", minLength: 20, maxLength: 5 },
              },
            },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1015: Non-standard usage ────────────────────────────────────────

Deno.test("E1015 — numeric exclusiveMinimum in 3.0.x spec", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Range: { type: "number", exclusiveMinimum: 0, maximum: 100 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.severity, "info");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("3.0.3"), true);
});

Deno.test("E1015 — numeric exclusiveMaximum in 3.0.x spec", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Range: { type: "number", minimum: 0, exclusiveMaximum: 100 },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1015 — boolean exclusiveMinimum in 3.1.x spec", async () => {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/health": { get: { responses: { "200": { description: "OK" } } } },
    },
    components: {
      schemas: {
        Range: {
          type: "number",
          minimum: 0,
          maximum: 100,
          exclusiveMinimum: true,
        },
      },
    },
  };

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("3.1.0"), true);
});

Deno.test("E1015 — boolean exclusiveMinimum in 3.0.x is fine (standard)", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Range: {
          type: "number",
          minimum: 0,
          maximum: 100,
          exclusiveMinimum: true,
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1015", 0);
});

Deno.test("E1015 — numeric exclusiveMinimum in 3.1.x is fine (standard)", async () => {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/health": { get: { responses: { "200": { description: "OK" } } } },
    },
    components: {
      schemas: {
        Range: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100 },
      },
    },
  };

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1015", 0);
});

// ── E1016: Required property not in properties ──────────────────────

Deno.test("E1016 — detects required field missing from properties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        User: {
          type: "object",
          required: ["name", "meta"],
          properties: {
            name: { type: "string" },
            has_more: { type: "boolean" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1016");
  assertEquals(d.message.includes("meta"), true);
  assertEquals(d.severity, "warning");
  assertEquals(d.category, "spec-issue");
});

Deno.test("E1016 — no false positive when all required are in properties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        User: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1016", 0);
});

Deno.test("E1016 — skips schemas with required but no properties", async () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Partial: {
          type: "object",
          required: ["id"],
        },
      },
    },
  });

  const result = await analyzeSpec(spec);
  filterCode(result.diagnostics, "E1016", 0);
});
