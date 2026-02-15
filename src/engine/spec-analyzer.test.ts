import { assertEquals } from "@std/assert";
import type { OpenAPISpec } from "@steady/openapi";
import type { Diagnostic } from "../diagnostic.ts";
import { analyzeSpec } from "./spec-analyzer.ts";

// ── Test helpers ────────────────────────────────────────────────────

/** Minimal valid OpenAPI 3.0 spec. No diagnostics expected. */
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

Deno.test("analyzeSpec - clean spec produces no diagnostics", () => {
  const result = analyzeSpec(minimalSpec());
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.fatal, false);
});

// ── E1013: Multiple question marks in path ──────────────────────────

Deno.test("E1013 - detects multiple question marks in path", () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1?page=2": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1013");
  assertEquals(d.severity, "warning");
  assertEquals(d.category, "spec-issue");
  assertEquals(d.requestPath, "");
  assertEquals(d.specPointer, "#/paths/~1search?q=1?page=2");
});

Deno.test("E1013 - single question mark is fine", () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1013", 0);
});

// ── E1014: Question mark in parameter name/enum ─────────────────────

Deno.test("E1014 - detects question mark in parameter name", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1014");
  assertEquals(d.message.includes("q?"), true);
});

Deno.test("E1014 - detects question mark in enum value", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1014");
  assertEquals(d.message.includes("inactive?"), true);
});

Deno.test("E1014 - resolves $ref parameters", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1014", 1);
});

Deno.test("E1014 - path-level parameters are checked", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1014", 1);
});

// ── E1008: Duplicate path patterns ──────────────────────────────────

Deno.test("E1008 - detects duplicate path patterns", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1008"); // One per conflict group
  assertEquals(d.message.includes("/users/{userId}"), true);
  assertEquals(d.message.includes("/users/{id}"), true);
});

Deno.test("E1008 - no false positive for different structures", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1008", 0);
});

// ── E1009: Duplicate path parameter names ───────────────────────────

Deno.test("E1009 - detects duplicate parameter names in path", () => {
  const spec = minimalSpec({
    paths: {
      "/users/{id}/posts/{id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1009");
  assertEquals(d.message.includes("{id}"), true);
});

Deno.test("E1009 - unique parameter names are fine", () => {
  const spec = minimalSpec({
    paths: {
      "/users/{userId}/posts/{postId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1009", 0);
});

// ── E1010: Missing responses ────────────────────────────────────────

Deno.test("E1010 - detects operation with empty responses", () => {
  const spec = minimalSpec({
    paths: {
      "/users": {
        get: { responses: {} },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1010");
  assertEquals(d.message.includes("GET /users"), true);
});

Deno.test("E1010 - operation with responses is fine", () => {
  const result = analyzeSpec(minimalSpec());
  filterCode(result.diagnostics, "E1010", 0);
});

// ── E1011: Invalid component names ──────────────────────────────────

Deno.test("E1011 - detects invalid component name", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        "Valid-Name.v1": { type: "object" },
        "Invalid Name": { type: "object" },
        "also/invalid": { type: "object" },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1011", 2); // "Invalid Name" and "also/invalid"
});

Deno.test("E1011 - valid component names are fine", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        "UserResponse": { type: "object" },
        "user-response": { type: "object" },
        "user.response.v1": { type: "object" },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1011", 0);
});

// ── E1007: Keywords alongside $ref (3.0.x) ─────────────────────────

Deno.test("E1007 - detects keywords alongside $ref in 3.0.x", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1007");
  assertEquals(d.message.includes("nullable"), true);
});

Deno.test("E1007 - summary/description alongside $ref are ignored", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

Deno.test("E1007 - no warning for webhook schemas", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

Deno.test("E1007 - no warning for 3.1.x specs", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1007", 0);
});

// ── E1004: Unresolved $ref ──────────────────────────────────────────

Deno.test("E1004 - detects unresolved $ref", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1004", 1);
  assertEquals(result.fatal, true);
});

Deno.test("E1004 - valid $ref produces no diagnostic", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1004", 0);
});

// ── E1005: Circular $ref ────────────────────────────────────────────

Deno.test("E1005 - suppresses cycle through optional property", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - suppresses indirect cycle through optional properties", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - non-circular refs are fine", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - detects forced self-reference (required property)", () => {
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

  const result = analyzeSpec(spec);
  const e1005 = result.diagnostics.filter((d) => d.code === "E1005");
  assertEquals(e1005.length >= 1, true);
});

Deno.test("E1005 - detects forced indirect cycle (all edges required)", () => {
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

  const result = analyzeSpec(spec);
  const e1005 = result.diagnostics.filter((d) => d.code === "E1005");
  assertEquals(e1005.length >= 1, true);
});

Deno.test("E1005 - suppresses cycle through array items", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - suppresses cycle through oneOf alternative", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - mixed: forced + optional edge → suppressed", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

// ── E1012: Impossible schema constraints ────────────────────────────

Deno.test("E1012 - detects minimum > maximum", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", minimum: 10, maximum: 5 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("minimum"), true);
});

Deno.test("E1012 - detects minLength > maxLength", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "string", minLength: 10, maxLength: 5 },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects minItems > maxItems", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects minProperties > maxProperties", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "object", minProperties: 5, maxProperties: 2 },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects required > maxProperties", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects empty enum", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "string", enum: [] },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects conflicting allOf types", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("conflicting types"), true);
});

Deno.test("E1012 - valid constraints produce no diagnostic", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: inline schemas ───────────────────────────────────────────

Deno.test("E1012 - detects impossible constraints in inline request body schema", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

Deno.test("E1012 - detects impossible constraints in inline response schema", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── Fatal flag ──────────────────────────────────────────────────────

Deno.test("analyzeSpec - fatal flag is true when E1004 is present", () => {
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

  const result = analyzeSpec(spec);
  assertEquals(result.fatal, true);
});

Deno.test("analyzeSpec - fatal flag is false for warnings only", () => {
  const spec = minimalSpec({
    paths: {
      "/search?q=1?page=2": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  const result = analyzeSpec(spec);
  assertEquals(result.fatal, false);
  assertEquals(result.diagnostics.length > 0, true);
});

// ── E1005: 3-node cycle ─────────────────────────────────────────────

Deno.test("E1005 - suppresses 3-node cycle through optional properties", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

Deno.test("E1005 - suppresses multiple independent optional cycles", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1005", 0);
});

// ── E1004: external refs are ignored ────────────────────────────────

Deno.test("E1004 - external refs (non-#) are not flagged as unresolved", () => {
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

  const result = analyzeSpec(spec);
  const e1004 = result.diagnostics.filter((d) => d.code === "E1004");
  assertEquals(e1004.length, 0);
});

// ── E1012: exclusive bounds (numeric, 3.1.x style) ─────────────────

Deno.test("E1012 - detects exclusiveMinimum >= maximum (numeric)", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", exclusiveMinimum: 10, maximum: 10 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
});

Deno.test("E1012 - detects minimum >= exclusiveMaximum (numeric)", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", minimum: 10, exclusiveMaximum: 10 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 - detects exclusiveMinimum >= exclusiveMaximum (numeric)", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "number", exclusiveMinimum: 5, exclusiveMaximum: 5 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 - valid exclusive bounds produce no diagnostic (numeric)", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100 },
      },
    },
  });

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: exclusive bounds (boolean, 3.0.x style) ─────────────────

Deno.test("E1012 - detects min == max with exclusiveMinimum: true (boolean)", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
});

Deno.test("E1012 - detects min == max with exclusiveMaximum: true (boolean)", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1012");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1012 - min < max with exclusiveMinimum: true is fine (boolean)", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 0);
});

// ── E1012: inline parameter schemas ─────────────────────────────────

Deno.test("E1012 - detects impossible constraint in inline parameter schema", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1012: path-level parameter schemas ─────────────────────────────

Deno.test("E1012 - detects impossible constraint in path-level parameter schema", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1012: nested property schemas ──────────────────────────────────

Deno.test("E1012 - detects impossible constraint in deeply nested schema", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1012", 1);
});

// ── E1015: Non-standard usage ────────────────────────────────────────

Deno.test("E1015 - numeric exclusiveMinimum in 3.0.x spec", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Range: { type: "number", exclusiveMinimum: 0, maximum: 100 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.severity, "info");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("3.0.3"), true);
});

Deno.test("E1015 - numeric exclusiveMaximum in 3.0.x spec", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Range: { type: "number", minimum: 0, exclusiveMaximum: 100 },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.message.includes("exclusiveMaximum"), true);
});

Deno.test("E1015 - boolean exclusiveMinimum in 3.1.x spec", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1015");
  assertEquals(d.message.includes("exclusiveMinimum"), true);
  assertEquals(d.message.includes("3.1.0"), true);
});

Deno.test("E1015 - boolean exclusiveMinimum in 3.0.x is fine (standard)", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1015", 0);
});

Deno.test("E1015 - numeric exclusiveMinimum in 3.1.x is fine (standard)", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1015", 0);
});

// ── E1016: Required property not in properties ──────────────────────

Deno.test("E1016 - detects required field missing from properties", () => {
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

  const result = analyzeSpec(spec);
  const d = singleDiag(result.diagnostics, "E1016");
  assertEquals(d.message.includes("meta"), true);
  assertEquals(d.severity, "warning");
  assertEquals(d.category, "spec-issue");
});

Deno.test("E1016 - no false positive when all required are in properties", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1016", 0);
});

Deno.test("E1016 - skips schemas with required but no properties", () => {
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

  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1016", 0);
});

// ── E1003: Missing metadata (defaulted fields) ──────────────────────

Deno.test("E1003 - reports diagnostics for defaulted fields", () => {
  const spec = minimalSpec();
  const result = analyzeSpec(spec, {
    defaultedFields: ["info.title", "paths"],
  });

  const e1003 = filterCode(result.diagnostics, "E1003", 2);

  // First diagnostic: info.title
  assertEquals(e1003[0]?.specPointer, "#/info/title");
  assertEquals(e1003[0]?.message.includes("info.title"), true);
  assertEquals(e1003[0]?.suggestion, 'Add the "info.title" field to your spec');

  assertEquals(e1003[0]?.severity, "error");
  assertEquals(e1003[0]?.category, "spec-issue");

  // Second diagnostic: paths
  assertEquals(e1003[1]?.specPointer, "#/paths");
  assertEquals(e1003[1]?.message.includes("paths"), true);
  assertEquals(e1003[1]?.suggestion, 'Add the "paths" field to your spec');
});

Deno.test("E1003 - no diagnostics when defaultedFields is empty", () => {
  const spec = minimalSpec();
  const result = analyzeSpec(spec, { defaultedFields: [] });
  filterCode(result.diagnostics, "E1003", 0);
});

Deno.test("E1003 - no diagnostics when defaultedFields is not provided", () => {
  const spec = minimalSpec();
  const result = analyzeSpec(spec);
  filterCode(result.diagnostics, "E1003", 0);
});

// ── E1012: allOf bound merging ───────────────────────────────────────

Deno.test("E1012 - detects impossible merged range across allOf members", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { type: "integer", minimum: 10 },
            { type: "integer", maximum: 5 },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const diags = result.diagnostics.filter((d) => d.code === "E1012");
  const merged = diags.find((d) => d.message.includes("allOf"));
  assertEquals(merged !== undefined, true, "should detect allOf bound merging");
});

Deno.test("E1012 - valid allOf bounds produce no diagnostic", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          allOf: [
            { type: "integer", minimum: 1 },
            { type: "integer", maximum: 100 },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const merged = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("allOf"),
  );
  assertEquals(merged.length, 0);
});

// ── E1012: type+format conflicts ─────────────────────────────────────

Deno.test("E1012 - detects type integer with format email", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "integer", format: "email" },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("format"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - no false positive for string with int64 format", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: { type: "string", format: "int64" },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("format"),
  );
  assertEquals(d.length, 0);
});

// ── E1012: pattern on non-string type ────────────────────────────────

Deno.test("E1012 - detects pattern on non-string type", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { type: "integer", pattern: "^[0-9]+$" },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("pattern"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - no false positive for pattern on string type", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: { type: "string", pattern: "^[a-z]+$" },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("pattern"),
  );
  assertEquals(d.length, 0);
});

// ── E1012: allOf enum intersection ──────────────────────────────────

Deno.test("E1012 - detects empty enum intersection in allOf", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { enum: ["a", "b"] },
            { enum: ["c", "d"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("enum intersection"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - no false positive for overlapping enum in allOf", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          allOf: [
            { enum: ["a", "b", "c"] },
            { enum: ["b", "c", "d"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("enum intersection"),
  );
  assertEquals(d.length, 0);
});

Deno.test("E1012 - detects empty enum intersection across 3 allOf members", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { enum: ["a", "b", "c"] },
            { enum: ["b", "c", "d"] },
            { enum: ["d", "e"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("enum intersection"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - single allOf member with enum is fine", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          allOf: [
            { enum: ["a", "b"] },
            { type: "string" },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("enum intersection"),
  );
  assertEquals(d.length, 0);
});

// ── E1012: const + enum conflict ─────────────────────────────────────

Deno.test("E1012 - detects const not in enum", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: { const: "x", enum: ["a", "b"] },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("const"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - no false positive when const is in enum", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: { const: "a", enum: ["a", "b"] },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("const"),
  );
  assertEquals(d.length, 0);
});

// ── E1012: allOf type array disjointness ─────────────────────────────

Deno.test("E1012 - detects disjoint type arrays in allOf", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { type: ["string", "boolean"] },
            { type: ["number", "integer"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("conflicting types"),
  );
  assertEquals(d.length, 1);
});

Deno.test("E1012 - no false positive for overlapping type arrays in allOf", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Good: {
          allOf: [
            { type: ["string", "number"] },
            { type: ["number", "integer"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("conflicting types"),
  );
  assertEquals(d.length, 0);
});

Deno.test("E1012 - detects string vs type array disjointness in allOf", () => {
  const spec = minimalSpec({
    components: {
      schemas: {
        Bad: {
          allOf: [
            { type: "string" },
            { type: ["number", "integer"] },
          ],
        },
      },
    },
  });

  const result = analyzeSpec(spec);
  const d = result.diagnostics.filter(
    (d) => d.code === "E1012" && d.message.includes("conflicting types"),
  );
  assertEquals(d.length, 1);
});
