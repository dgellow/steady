import { assertEquals } from "@std/assert";
import type { OperationObject, PathsObject } from "@steady/openapi";
import type { Schema } from "@steady/json-schema";
import type { FragmentPointer } from "@steady/json-pointer";
import type { ValidationNode } from "./types.ts";
import {
  type BodySchemaInfo,
  DiagnosticEngine,
  type ResolvedParameter,
  type SchemaValidator,
  type Spec,
} from "./diagnostic-engine.ts";
import { Router } from "../router.ts";

// ── Test stubs ──────────────────────────────────────────────────────

/** Minimal valid operation for path routing. */
const OP: OperationObject = {
  responses: { "200": { description: "OK" } },
};

/**
 * Stub implementation of Spec for testing.
 *
 * Returns pre-configured data regardless of pathPattern/method.
 * Tests configure the stub with the data the engine should see.
 */
class StubSpec implements Spec {
  /** Paths used to construct the Router. Not part of the Spec interface. */
  readonly paths: PathsObject;
  parameters: ResolvedParameter[] = [];
  bodySchema: BodySchemaInfo | null = null;
  responses = true;
  schemas = new Map<string, Schema>();
  acceptedContentTypes: string[] | null = null;

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
    _contentType: string,
  ): BodySchemaInfo | null {
    return this.bodySchema;
  }

  hasResponses(
    _pathPattern: string,
    _method: string,
  ): boolean {
    return this.responses;
  }

  getAcceptedContentTypes(
    _pathPattern: string,
    _method: string,
  ): string[] | null {
    return this.acceptedContentTypes;
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
    schemaPath: FragmentPointer,
    dataPath: string[],
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

/** Helper: create a DiagnosticEngine with a Router from the StubSpec's paths. */
function createEngine(
  spec: StubSpec,
  validator: StubValidator = new StubValidator(),
): DiagnosticEngine {
  const router = new Router(spec.paths);
  return new DiagnosticEngine(spec, validator, router);
}

// ── Tests ───────────────────────────────────────────────────────────

Deno.test("DiagnosticEngine", async (t) => {
  // ── Routing integration ─────────────────────────────────────────

  await t.step("route not found → E2001", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/posts", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E2001");
  });

  await t.step("method not allowed → E2002", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "delete" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E2002");
  });

  // ── Spec issues ─────────────────────────────────────────────────

  await t.step("no responses → E1010", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.responses = false;
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E1010");
    assertEquals(result[0]!.category, "spec-issue");
  });

  // ── Parameter presence ──────────────────────────────────────────

  await t.step("missing required query param → E3002", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3002");
    assertEquals(result[0]!.category, "sdk-issue");
    assertEquals(result[0]!.requestPath, "query.limit");
  });

  await t.step("missing required header → E3004", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "X-Api-Key",
        in: "header",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3004");
    assertEquals(result[0]!.category, "sdk-issue");
    assertEquals(result[0]!.requestPath, "header.X-Api-Key");
  });

  await t.step("optional param missing → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 0);
  });

  await t.step("required params present → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: true,
        schema: null,
        schemaPath: null,
      },
      {
        name: "X-Api-Key",
        in: "header",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

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
      {
        name: "X-Api-Key",
        in: "header",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

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
      {
        name: "limit",
        in: "query",
        required: true,
        schema: null,
        schemaPath: null,
      },
      {
        name: "offset",
        in: "query",
        required: true,
        schema: null,
        schemaPath: null,
      },
      {
        name: "X-Api-Key",
        in: "header",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

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
    const leafSchemaPath: FragmentPointer = `${bodySchemaPath}/properties/name`;

    const bodySchema: Schema = {
      type: "object",
      required: ["name"],
    };

    const validator = new StubValidator();
    validator.register(bodySchemaPath, {
      valid: false,
      path: ["body"],
      schemaPath: bodySchemaPath,
      children: [
        {
          valid: false,
          keyword: "required",
          path: ["body", "name"],
          schemaPath: leafSchemaPath,
          field: "name",
        },
      ],
    });

    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: bodySchema,
      schemaPath: bodySchemaPath,
      required: true,
    };
    spec.schemas.set(leafSchemaPath, {});

    const engine = createEngine(spec, validator);

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
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 0);
  });

  await t.step("required body missing → E3005", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath: "#/paths/~1users/post/requestBody/...",
      required: true,
    };
    const engine = createEngine(spec);

    // No body in request
    const result = engine.analyze({ path: "/users", method: "post" });

    assertEquals(result.length, 1);
    assertEquals(result[0]!.code, "E3005");
    assertEquals(result[0]!.category, "sdk-issue");
  });

  await t.step(
    "optional body missing → no diagnostics",
    () => {
      const spec = new StubSpec({ "/users": { post: OP } });
      spec.bodySchema = {
        schema: { type: "object" },
        schemaPath: "#/paths/~1users/post/requestBody/...",
        required: false,
      };
      const engine = createEngine(spec);

      const result = engine.analyze({ path: "/users", method: "post" });

      assertEquals(result.length, 0);
    },
  );

  await t.step("body schema but no body in request → no diagnostics", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath: "#/paths/~1users/post/requestBody/...",
      required: false,
    };
    const engine = createEngine(spec);

    // No body in request
    const result = engine.analyze({ path: "/users", method: "post" });

    assertEquals(result.length, 0);
  });

  // ── Full flow ───────────────────────────────────────────────────

  await t.step("full flow: param missing + body error → both", () => {
    const bodySchemaPath =
      "#/paths/~1users/post/requestBody/content/application~1json/schema";
    const leafSchemaPath: FragmentPointer =
      `${bodySchemaPath}/properties/email`;

    const validator = new StubValidator();
    validator.register(bodySchemaPath, {
      valid: false,
      path: ["body"],
      schemaPath: bodySchemaPath,
      children: [
        {
          valid: false,
          keyword: "pattern",
          path: ["body", "email"],
          schemaPath: leafSchemaPath,
        },
      ],
    });

    const spec = new StubSpec({ "/users": { post: OP } });
    spec.parameters = [
      {
        name: "X-Api-Key",
        in: "header",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath: bodySchemaPath,
      required: true,
    };
    spec.schemas.set(leafSchemaPath, { pattern: "^.+@.+$" });

    const engine = createEngine(spec, validator);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      body: { email: "bad" },
    });

    assertEquals(result.length, 2);
    assertEquals(result[0]!.code, "E3004"); // missing header
    assertEquals(result[1]!.code, "E4002"); // pattern mismatch
  });

  // ── Parameter value validation ──────────────────────────────────

  await t.step(
    "present query param with schema: validation failure → diagnostic",
    () => {
      const paramSchemaPath = "#/paths/~1users/get/parameters/0/schema";

      const validator = new StubValidator();
      validator.register(paramSchemaPath, {
        valid: false,
        path: ["query", "limit"],
        schemaPath: paramSchemaPath,
        keyword: "type",
        expected: "integer",
        actual: "string",
      });

      const spec = new StubSpec({ "/users": { get: OP } });
      spec.parameters = [
        {
          name: "limit",
          in: "query",
          required: true,
          schema: { type: "integer" },
          schemaPath: paramSchemaPath,
        },
      ];
      spec.schemas.set(paramSchemaPath, { type: "integer" });

      const engine = createEngine(spec, validator);
      const queryParams = new URLSearchParams();
      queryParams.set("limit", "abc");

      const result = engine.analyze({
        path: "/users",
        method: "get",
        queryParams,
      });

      assertEquals(result.length, 1);
      assertEquals(result[0]!.code, "E3003");
    },
  );

  await t.step(
    "present query param with no schema → no value validation",
    () => {
      const spec = new StubSpec({ "/users": { get: OP } });
      spec.parameters = [
        {
          name: "limit",
          in: "query",
          required: true,
          schema: null,
          schemaPath: null,
        },
      ];
      const engine = createEngine(spec);

      const queryParams = new URLSearchParams();
      queryParams.set("limit", "abc");

      const result = engine.analyze({
        path: "/users",
        method: "get",
        queryParams,
      });

      assertEquals(result.length, 0);
    },
  );

  await t.step(
    "present header param with schema: validation failure → diagnostic",
    () => {
      const paramSchemaPath = "#/paths/~1users/get/parameters/0/schema";

      const validator = new StubValidator();
      validator.register(paramSchemaPath, {
        valid: false,
        path: ["header", "X-Count"],
        schemaPath: paramSchemaPath,
        keyword: "enum",
        actual: "bad",
        expected: ["a", "b"],
      });

      const spec = new StubSpec({ "/users": { get: OP } });
      spec.parameters = [
        {
          name: "X-Count",
          in: "header",
          required: false,
          schema: { enum: ["a", "b"] },
          schemaPath: paramSchemaPath,
        },
      ];
      spec.schemas.set(paramSchemaPath, { enum: ["a", "b"] });

      const engine = createEngine(spec, validator);

      const result = engine.analyze({
        path: "/users",
        method: "get",
        headers: { "x-count": "bad" },
      });

      assertEquals(result.length, 1);
      assertEquals(result[0]!.code, "E3016");
    },
  );

  await t.step(
    "missing required param skips value validation (only E3002)",
    () => {
      const paramSchemaPath = "#/paths/~1users/get/parameters/0/schema";

      const spec = new StubSpec({ "/users": { get: OP } });
      spec.parameters = [
        {
          name: "limit",
          in: "query",
          required: true,
          schema: { type: "integer" },
          schemaPath: paramSchemaPath,
        },
      ];
      const engine = createEngine(spec);

      // No queryParams at all. Param is missing
      const result = engine.analyze({ path: "/users", method: "get" });

      assertEquals(result.length, 1);
      assertEquals(result[0]!.code, "E3002");
    },
  );

  // ── Path parameter value validation ─────────────────────────────

  await t.step(
    "path param with wrong type → diagnostic when pathParams provided",
    () => {
      const paramSchemaPath = "#/paths/~1users~1{id}/get/parameters/0/schema";

      const validator = new StubValidator();
      validator.register(paramSchemaPath, {
        valid: false,
        path: ["path", "id"],
        schemaPath: paramSchemaPath,
        keyword: "type",
        expected: "integer",
        actual: "string",
      });

      const spec = new StubSpec({ "/users/{id}": { get: OP } });
      spec.parameters = [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          schemaPath: paramSchemaPath,
        },
      ];
      spec.schemas.set(paramSchemaPath, { type: "integer" });

      const engine = createEngine(spec, validator);

      const result = engine.analyze({
        path: "/users/not-a-number",
        method: "get",
        pathParams: { id: "not-a-number" },
      });

      assertEquals(result.length, 1);
      assertEquals(result[0]?.code, "E3001");
    },
  );

  await t.step(
    "path param with valid value → no diagnostic",
    () => {
      const paramSchemaPath = "#/paths/~1users~1{id}/get/parameters/0/schema";

      const spec = new StubSpec({ "/users/{id}": { get: OP } });
      spec.parameters = [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          schemaPath: paramSchemaPath,
        },
      ];
      spec.schemas.set(paramSchemaPath, { type: "integer" });

      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/users/123",
        method: "get",
        pathParams: { id: "123" },
      });

      assertEquals(result.length, 0);
    },
  );

  await t.step(
    "path param without pathParams in request → no value validation",
    () => {
      const paramSchemaPath = "#/paths/~1users~1{id}/get/parameters/0/schema";

      const spec = new StubSpec({ "/users/{id}": { get: OP } });
      spec.parameters = [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          schemaPath: paramSchemaPath,
        },
      ];

      const engine = createEngine(spec);

      // No pathParams. Engine can't validate, should produce no diagnostic
      const result = engine.analyze({
        path: "/users/not-a-number",
        method: "get",
      });

      assertEquals(result.length, 0);
    },
  );

  // ── Cookie parameter support ────────────────────────────────────

  await t.step("missing required cookie → E3007", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "session",
        in: "cookie",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    // No Cookie header at all
    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 1);
    assertEquals(result[0]?.code, "E3007");
    assertEquals(result[0]?.category, "sdk-issue");
    assertEquals(result[0]?.requestPath, "cookie.session");
  });

  await t.step(
    "missing required cookie (other cookies present) → E3007",
    () => {
      const spec = new StubSpec({ "/users": { get: OP } });
      spec.parameters = [
        {
          name: "session",
          in: "cookie",
          required: true,
          schema: null,
          schemaPath: null,
        },
      ];
      const engine = createEngine(spec);

      // Cookie header present but doesn't contain "session"
      const result = engine.analyze({
        path: "/users",
        method: "get",
        headers: { cookie: "theme=dark; lang=en" },
      });

      assertEquals(result.length, 1);
      assertEquals(result[0]?.code, "E3007");
    },
  );

  await t.step("optional cookie missing → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "theme",
        in: "cookie",
        required: false,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({ path: "/users", method: "get" });

    assertEquals(result.length, 0);
  });

  await t.step("required cookie present → no diagnostic", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "session",
        in: "cookie",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { cookie: "session=abc123" },
    });

    assertEquals(result.length, 0);
  });

  await t.step("cookie type mismatch → E3008", () => {
    const paramSchemaPath = "#/paths/~1users/get/parameters/0/schema";

    const validator = new StubValidator();
    validator.register(paramSchemaPath, {
      valid: false,
      path: ["cookie", "max_age"],
      schemaPath: paramSchemaPath,
      keyword: "type",
      expected: "integer",
      actual: "string",
    });

    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "max_age",
        in: "cookie",
        required: false,
        schema: { type: "integer" },
        schemaPath: paramSchemaPath,
      },
    ];
    spec.schemas.set(paramSchemaPath, { type: "integer" });

    const engine = createEngine(spec, validator);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { cookie: "max_age=not-a-number" },
    });

    assertEquals(result.length, 1);
    assertEquals(result[0]?.code, "E3008");
  });

  await t.step("cookie with valid value → no diagnostic", () => {
    const paramSchemaPath = "#/paths/~1users/get/parameters/0/schema";

    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "max_age",
        in: "cookie",
        required: false,
        schema: { type: "integer" },
        schemaPath: paramSchemaPath,
      },
    ];
    spec.schemas.set(paramSchemaPath, { type: "integer" });

    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { cookie: "max_age=30" },
    });

    assertEquals(result.length, 0);
  });

  // ── Content-Type validation ─────────────────────────────────────

  await t.step("wrong Content-Type → E3006", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath:
        "#/paths/~1users/post/requestBody/content/application~1json/schema",
      required: true,
    };
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      headers: { "content-type": "text/plain" },
      body: {},
    });

    const e3006 = result.find((d) => d.code === "E3006");
    assertEquals(e3006 !== undefined, true);
    assertEquals(e3006?.category, "sdk-issue");
    assertEquals(e3006?.severity, "error");
  });

  await t.step("matching Content-Type → no E3006", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath:
        "#/paths/~1users/post/requestBody/content/application~1json/schema",
      required: true,
    };
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      headers: { "content-type": "application/json" },
      body: {},
    });

    assertEquals(result.filter((d) => d.code === "E3006").length, 0);
  });

  await t.step("Content-Type with parameters matches → no E3006", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath:
        "#/paths/~1users/post/requestBody/content/application~1json/schema",
      required: true,
    };
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {},
    });

    assertEquals(result.filter((d) => d.code === "E3006").length, 0);
  });

  await t.step("no Content-Type header → no E3006", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath:
        "#/paths/~1users/post/requestBody/content/application~1json/schema",
      required: true,
    };
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      body: {},
    });

    assertEquals(result.filter((d) => d.code === "E3006").length, 0);
  });

  await t.step(
    "wildcard */* in spec accepts any Content-Type → no E3006",
    () => {
      const spec = new StubSpec({ "/kv": { put: OP } });
      spec.bodySchema = {
        schema: { type: "string" },
        schemaPath: "#/paths/~1kv/put/requestBody/content/*~1*/schema",
        required: true,
      };
      spec.acceptedContentTypes = ["*/*", "multipart/form-data"];
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/kv",
        method: "put",
        headers: { "content-type": "application/json" },
        body: "value",
      });

      assertEquals(
        result.filter((d) => d.code === "E3006").length,
        0,
        `Should accept application/json when spec declares */*. Got: ${
          JSON.stringify(result.filter((d) => d.code === "E3006"))
        }`,
      );
    },
  );

  await t.step("no requestBody in spec → no E3006", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    // acceptedContentTypes is null by default (no requestBody)
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { "content-type": "text/plain" },
    });

    assertEquals(result.filter((d) => d.code === "E3006").length, 0);
  });

  // ── Malformed Content-Type ──────────────────────────────────────

  await t.step("malformed Content-Type → E3020", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.bodySchema = {
      schema: { type: "object" },
      schemaPath:
        "#/paths/~1users/post/requestBody/content/application~1json/schema",
      required: true,
    };
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      headers: { "content-type": "; utf-8" },
      body: {},
    });

    const e3020 = result.find((d) => d.code === "E3020");
    assertEquals(e3020 !== undefined, true);
    assertEquals(e3020?.category, "sdk-issue");
    assertEquals(e3020?.severity, "error");
  });

  await t.step(
    "malformed Content-Type without requestBody in spec → E3020",
    () => {
      const spec = new StubSpec({ "/users": { post: OP } });
      // No acceptedContentTypes set (null) - E3020 fires regardless
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/users",
        method: "post",
        headers: { "content-type": "; utf-8" },
        body: {},
      });

      const e3020 = result.find((d) => d.code === "E3020");
      assertEquals(e3020 !== undefined, true);
    },
  );

  await t.step("valid Content-Type → no E3020", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    spec.acceptedContentTypes = ["application/json"];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      headers: { "content-type": "application/json" },
      body: {},
    });

    assertEquals(result.filter((d) => d.code === "E3020").length, 0);
  });

  await t.step("no Content-Type header → no E3020", () => {
    const spec = new StubSpec({ "/users": { post: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "post",
      body: {},
    });

    assertEquals(result.filter((d) => d.code === "E3020").length, 0);
  });

  // ── Malformed Accept header ───────────────────────────────────────

  await t.step("fully malformed Accept header → E3022", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { "accept": ";;;" },
    });

    const e3022 = result.find((d) => d.code === "E3022");
    assertEquals(e3022 !== undefined, true);
    assertEquals(e3022?.category, "sdk-issue");
    assertEquals(e3022?.severity, "warning");
  });

  await t.step("Accept that servers tolerate → no E3022", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    // E3022 is sdk-issue, so it rejects the request by default. It is kept
    // for headers nothing can be read from. These are sloppy but accepted
    // by real servers: a weight outside the qvalue grammar (Java sends
    // "q=.2"), and a member that is not a type/subtype pair.
    for (
      const accept of [
        "*/*;q=.8",
        "application/json;q=.9",
        "application/json;q=5",
        "application/json; q=0.5000",
        "text/html, image/gif, image/jpeg, *; q=.2, */*; q=.2",
        "*",
        "json",
      ]
    ) {
      const result = engine.analyze({
        path: "/users",
        method: "get",
        headers: { "accept": accept },
      });
      assertEquals(
        result.filter((d) => d.code === "E3022").length,
        0,
        `Accept: ${accept}`,
      );
    }
  });

  await t.step("Accept with one valid entry → no E3022", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
      headers: { "accept": "garbage, application/json" },
    });

    assertEquals(result.filter((d) => d.code === "E3022").length, 0);
  });

  await t.step("no Accept header → no E3022", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
    });

    assertEquals(result.filter((d) => d.code === "E3022").length, 0);
  });

  // ── Unknown query parameter detection ──────────────────────────

  await t.step("bracket param when spec defines base name → E3014", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "items",
        in: "query",
        required: false,
        schema: { type: "array" },
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const queryParams = new URLSearchParams();
    queryParams.append("items[]", "a");
    queryParams.append("items[]", "b");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    const e3014 = result.filter((d) => d.code === "E3014");
    assertEquals(e3014.length, 1);
    assertEquals(e3014[0]?.category, "sdk-issue");
    assertEquals(e3014[0]?.severity, "warning");
  });

  await t.step("dot-notation param when spec defines base name → E3014", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "user",
        in: "query",
        required: false,
        schema: { type: "object" },
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const queryParams = new URLSearchParams();
    queryParams.set("user.name", "alice");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    const e3014 = result.filter((d) => d.code === "E3014");
    assertEquals(e3014.length, 1);
  });

  await t.step("truly undocumented query param → E3015", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const queryParams = new URLSearchParams();
    queryParams.set("limit", "10");
    queryParams.set("debug_mode", "true");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    const e3015 = result.filter((d) => d.code === "E3015");
    assertEquals(e3015.length, 1);
    assertEquals(e3015[0]?.category, "ambiguous");
    assertEquals(e3015[0]?.severity, "info");
  });

  await t.step("known query params → no E3014/E3015", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: null,
        schemaPath: null,
      },
      {
        name: "page",
        in: "query",
        required: false,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const queryParams = new URLSearchParams();
    queryParams.set("limit", "10");
    queryParams.set("page", "1");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    assertEquals(result.filter((d) => d.code === "E3014").length, 0);
    assertEquals(result.filter((d) => d.code === "E3015").length, 0);
  });

  await t.step("no query params → no E3014/E3015", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const result = engine.analyze({
      path: "/users",
      method: "get",
    });

    assertEquals(result.filter((d) => d.code === "E3014").length, 0);
    assertEquals(result.filter((d) => d.code === "E3015").length, 0);
  });

  // ── Valid request ───────────────────────────────────────────────

  await t.step("valid request → no diagnostics", () => {
    const spec = new StubSpec({ "/users": { get: OP } });
    spec.parameters = [
      {
        name: "limit",
        in: "query",
        required: true,
        schema: null,
        schemaPath: null,
      },
    ];
    const engine = createEngine(spec);

    const queryParams = new URLSearchParams();
    queryParams.set("limit", "10");

    const result = engine.analyze({
      path: "/users",
      method: "get",
      queryParams,
    });

    assertEquals(result.length, 0);
  });

  // ── Form array format mismatch (E3023) ────────────────────────────

  await t.step(
    "bracket form key when formArrayFormat is comma → E3023",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" } },
        },
      };
      const spec = new StubSpec({ "/skills": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/skills",
        method: "post",
        body: {},
        rawFormKeys: ["files[]"],
        formArrayFormat: "comma",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.category, "sdk-issue");
      assertEquals(e3023[0]?.severity, "warning");
    },
  );

  await t.step(
    "bracket form key when formArrayFormat is brackets → no E3023",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" } },
        },
      };
      const spec = new StubSpec({ "/skills": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/skills",
        method: "post",
        body: {},
        rawFormKeys: ["files[]"],
        formArrayFormat: "brackets",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 0);
    },
  );

  await t.step(
    "bare repeated key when formArrayFormat is brackets → E3023",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      };
      const spec = new StubSpec({ "/items": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/items",
        method: "post",
        body: {},
        rawFormKeys: ["tags", "tags", "tags"],
        formArrayFormat: "brackets",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
    },
  );

  await t.step(
    "bracket form key for unknown field → no E3023",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };
      const spec = new StubSpec({ "/skills": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      // "unknown[]" has base name "unknown" which is NOT in the schema
      const result = engine.analyze({
        path: "/skills",
        method: "post",
        body: {},
        rawFormKeys: ["unknown[]"],
        formArrayFormat: "comma",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 0);
    },
  );

  // ── Form object-format mismatch (E3023) ───────────────────────────

  await t.step(
    "dot-notation form key when formObjectFormat is flat → E3023 suggesting dots",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            type: "object",
            properties: { anchor: { type: "string" } },
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.actual, "dots");
      assertEquals(e3023[0]?.expected, "flat");
      // suggestion mentions the object-format flag, not the array-format flag
      assertEquals(
        e3023[0]?.suggestion?.includes("--validator-form-object-format=dots"),
        true,
      );
    },
  );

  await t.step(
    "bracket-notation form key when formObjectFormat is flat → E3023 suggesting brackets",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            type: "object",
            properties: { anchor: { type: "string" } },
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after[anchor]"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.actual, "brackets");
      assertEquals(
        e3023[0]?.suggestion?.includes(
          "--validator-form-object-format=brackets",
        ),
        true,
      );
    },
  );

  await t.step(
    "dot-notation form key when formObjectFormat is brackets → E3023 suggesting dots",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            type: "object",
            properties: { anchor: { type: "string" } },
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "brackets",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.actual, "dots");
    },
  );

  await t.step(
    "dot-notation form key for unknown field → no E3023",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["unknown.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 0);
    },
  );

  // ── Dot-notation detection on the array axis (E3023) ─────────────

  await t.step(
    "dot-notation form key when formArrayFormat is repeat → E3023 suggesting dots",
    () => {
      // This is the Stainless Go SDK shape: a nested object is sent with
      // dot-flattened keys (expires_after.anchor), but the array format
      // flag defaults to repeat and the existing array-format detector
      // never checked for dot notation.
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            type: "object",
            properties: { anchor: { type: "string" } },
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.actual, "dots");
    },
  );

  await t.step(
    "dot-notation on allOf-wrapped object property → E3023 on object axis",
    () => {
      // The composition case: property schema uses allOf to compose the
      // object shape. `resolveFormatAxis` walks composition via
      // `effectiveType`/`isObjectSchema` and must route to the object axis.
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            allOf: [
              {
                type: "object",
                properties: { anchor: { type: "string" } },
              },
            ],
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(e3023[0]?.actual, "dots");
      assertEquals(
        e3023[0]?.suggestion?.includes("--validator-form-object-format=dots"),
        true,
      );
    },
  );

  await t.step(
    "dot-notation on anyOf-wrapped object property → E3023 on object axis",
    () => {
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: {
            anyOf: [
              {
                type: "object",
                properties: { anchor: { type: "string" } },
              },
              { type: "null" },
            ],
          },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(
        e3023[0]?.suggestion?.includes("--validator-form-object-format=dots"),
        true,
      );
    },
  );

  await t.step(
    "dot-notation on $ref-wrapped object property → E3023 on object axis",
    () => {
      const refTarget: Schema = {
        type: "object",
        properties: { anchor: { type: "string" } },
      };
      const schema: Schema = {
        type: "object",
        properties: {
          expires_after: { $ref: "#/components/schemas/ExpiresAfter" },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      spec.schemas.set("#/components/schemas/ExpiresAfter", refTarget);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["expires_after.anchor"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(
        e3023[0]?.suggestion?.includes("--validator-form-object-format=dots"),
        true,
      );
    },
  );

  await t.step(
    "dot-notation on array-of-primitive property → E3023 on array axis",
    () => {
      // Making sure the axis logic doesn't mis-route arrays to the
      // object axis: a `type: array` property should stay on the
      // array axis even though it has a "." in the key.
      const schema: Schema = {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      };
      const spec = new StubSpec({ "/files": { post: OP } });
      spec.bodySchema = {
        schema,
        schemaPath: "#/schema",
        required: false,
      };
      spec.schemas.set("#/schema", schema);
      const engine = createEngine(spec);

      const result = engine.analyze({
        path: "/files",
        method: "post",
        body: {},
        rawFormKeys: ["tags.0"],
        formArrayFormat: "repeat",
        formObjectFormat: "flat",
      });

      const e3023 = result.filter((d) => d.code === "E3023");
      assertEquals(e3023.length, 1);
      assertEquals(
        e3023[0]?.suggestion?.includes("--validator-form-array-format=dots"),
        true,
      );
    },
  );
});
