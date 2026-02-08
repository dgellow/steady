import { assertEquals } from "@std/assert";
import type { PathsObject, OperationObject } from "@steady/openapi";
import type { Schema } from "@steady/json-schema";
import type { ValidationNode } from "./types.ts";
import {
  DiagnosticEngine,
  type BodySchemaInfo,
  type ResolvedParameter,
  type SchemaValidator,
  type SpecDocument,
} from "./diagnostic-engine.ts";

// ── Test stubs ──────────────────────────────────────────────────────

/** Minimal valid operation for path routing. */
const OP: OperationObject = {
  responses: { "200": { description: "OK" } },
};

/**
 * Stub implementation of SpecDocument for testing.
 *
 * Returns pre-configured data regardless of pathPattern/method.
 * Tests configure the stub with the data the engine should see.
 */
class StubSpec implements SpecDocument {
  paths: PathsObject;
  parameters: ResolvedParameter[] = [];
  bodySchema: BodySchemaInfo | null = null;
  responses = true;
  schemas = new Map<string, Schema>();

  constructor(paths: PathsObject) {
    this.paths = paths;
  }

  getParameters(
    _pathPattern: string,
    _method: string,
  ): ResolvedParameter[] {
    return this.parameters;
  }

  getBodySchema(
    _pathPattern: string,
    _method: string,
  ): BodySchemaInfo | null {
    return this.bodySchema;
  }

  hasResponses(
    _pathPattern: string,
    _method: string,
  ): boolean {
    return this.responses;
  }

  resolveSchema(schemaPath: string): Schema {
    return this.schemas.get(schemaPath) ?? {};
  }
}

/**
 * Stub validator that returns pre-configured trees by schema path.
 * Returns a valid tree by default if no tree is registered.
 */
class StubValidator implements SchemaValidator {
  private trees = new Map<string, ValidationNode>();

  register(schemaPath: string, tree: ValidationNode): void {
    this.trees.set(schemaPath, tree);
  }

  validate(
    _data: unknown,
    _schema: Schema,
    schemaPath: string,
    dataPath: string,
  ): ValidationNode {
    return (
      this.trees.get(schemaPath) ?? {
        valid: true,
        path: dataPath,
        schemaPath,
      }
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────

Deno.test("DiagnosticEngine", async (t) => {
  // ── Routing integration ─────────────────────────────────────────

  await t.step("route not found → E2001", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/posts", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E2001");
  });

  await t.step("method not allowed → E2002", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "delete" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E2002");
  });

  // ── Spec issues ─────────────────────────────────────────────────

  await t.step("no responses → E1010", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.responses = false;
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E1010");
    assertEquals(result[0]!.category, "spec-issue");
  });

  // ── Parameter presence ──────────────────────────────────────────

  await t.step("missing required query param → E3002", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "limit", in: "query", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3002");
    assertEquals(result[0]!.category, "sdk-issue");
    assertEquals(result[0]!.requestPath, "query.limit");
  });

  await t.step("missing required header → E3004", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "X-Api-Key", in: "header", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3004");
    assertEquals(result[0]!.category, "sdk-issue");
    assertEquals(result[0]!.requestPath, "header.X-Api-Key");
  });

  await t.step("optional param missing → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "limit", in: "query", required: false, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 0);
  });

  await t.step("required params present → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "limit", in: "query", required: true, schema: null, schemaPath: null },
      { name: "X-Api-Key", in: "header", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const queryParams = new URLSearchParams();
    queryParams.set("limit", "10");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
      headers: { "x-api-key": "secret" },
    });

    assertEquals(result.length, 0);
  });

  await t.step("header matching is case-insensitive", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "X-Api-Key", in: "header", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { "x-api-key": "secret" },
    });

    assertEquals(result.length, 0);
  });

  await t.step("multiple missing params → multiple diagnostics", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "limit", in: "query", required: true, schema: null, schemaPath: null },
      { name: "offset", in: "query", required: true, schema: null, schemaPath: null },
      { name: "X-Api-Key", in: "header", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 3);
    const codes = result.map((d) => d.code);
    assertEquals(codes.filter((c) => c === "E3002").length, 2);
    assertEquals(codes.filter((c) => c === "E3004").length, 1);
  });

  // ── Body validation ─────────────────────────────────────────────

  await t.step("body validation: tree with failure → diagnostic", () => {
    const bodySchemaPath =
      "#/paths/~1users/post/requestBody/content/application~1json/schema";
    const leafSchemaPath = bodySchemaPath + "/properties/name";

    const bodySchema: Schema = {
      type: "object",
      required: ["name"],
    };

    const validator = new StubValidator();
    validator.register(bodySchemaPath, {
      valid: false,
      path: "body",
      schemaPath: bodySchemaPath,
      children: [
        {
          valid: false,
          keyword: "required",
          path: "body.name",
          schemaPath: leafSchemaPath,
          field: "name",
        },
      ],
    });

    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = { schema: bodySchema, schemaPath: bodySchemaPath };
    spec.schemas.set(leafSchemaPath, {});

    const engine = new DiagnosticEngine(spec, validator);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      body: {},
    });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3007");
  });

  await t.step("no body schema → no body diagnostics", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    // bodySchema is null by default
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 0);
  });

  await t.step("body schema but no body in request → no diagnostics", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath: "#/paths/~1users/post/requestBody/...",
    };
    const engine = new DiagnosticEngine(spec, new StubValidator());

    // No body in request
    const result = engine.analyze({ path: "/users", method: "post" });

    assertEquals(result.length, 0);
  });

  // ── Full flow ───────────────────────────────────────────────────

  await t.step("full flow: param missing + body error → both", () => {
    const bodySchemaPath =
      "#/paths/~1users/post/requestBody/content/application~1json/schema";
    const leafSchemaPath = bodySchemaPath + "/properties/email";

    const validator = new StubValidator();
    validator.register(bodySchemaPath, {
      valid: false,
      path: "body",
      schemaPath: bodySchemaPath,
      children: [
        {
          valid: false,
          keyword: "pattern",
          path: "body.email",
          schemaPath: leafSchemaPath,
        },
      ],
    });

    const spec = new StubSpec({ "/users": { post: OP } });
    spec.parameters = [
      { name: "X-Api-Key", in: "header", required: true, schema: null, schemaPath: null },
    ];
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath: bodySchemaPath,
    };
    spec.schemas.set(leafSchemaPath, { pattern: "^.+@.+$" });

    const engine = new DiagnosticEngine(spec, validator);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      body: { email: "bad" },
    });

    assertEquals(result.length, 2);
    assertEquals(result[0]!.code, "E3004"); // missing header
    assertEquals(result[1]!.code, "E4002"); // pattern mismatch
  });

  // ── Valid request ───────────────────────────────────────────────

  await t.step("valid request → no diagnostics", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      { name: "limit", in: "query", required: true, schema: null, schemaPath: null },
    ];
    const engine = new DiagnosticEngine(spec, new StubValidator());

    const queryParams = new URLSearchParams();
    queryParams.set("limit", "10");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    assertEquals(result.length, 0);
  });
});
