/**
 * Tests for RequestValidator
 *
 * Unit tests for validation logic including:
 * - Query parameter validation
 * - Path parameter validation
 * - Header validation
 * - Request body validation
 * - Content-Type handling
 * - Size limit enforcement
 */

import { assertEquals, assertExists } from "@std/assert";
import { RequestValidator } from "./validator.ts";
import type { OperationObject } from "@steady/openapi";
import { SchemaRegistry } from "@steady/json-schema";

/** Create a minimal schema registry for unit tests */
function createTestRegistry(): SchemaRegistry {
  // For unit tests with inline schemas (no $refs), we just need an empty document
  return new SchemaRegistry({});
}

/** Create a validator with a test registry */
function createValidator(): RequestValidator {
  return new RequestValidator(createTestRegistry());
}

type SchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/** Helper to create a minimal operation with query params */
function operationWithQueryParams(
  params: Array<{
    name: string;
    required?: boolean;
    schema?: { type: SchemaType; minimum?: number; maximum?: number };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "query" as const,
      required: p.required ?? false,
      schema: p.schema ?? { type: "string" as const },
    })),
  };
}

/** Helper to create a minimal operation with path params */
function operationWithPathParams(
  params: Array<{
    name: string;
    schema?: { type: SchemaType };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "path" as const,
      required: true,
      schema: p.schema ?? { type: "string" as const },
    })),
  };
}

/** Helper to create a minimal operation with header params */
function operationWithHeaders(
  params: Array<{
    name: string;
    required?: boolean;
    schema?: { type: SchemaType };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "header" as const,
      required: p.required ?? false,
      schema: p.schema ?? { type: "string" as const },
    })),
  };
}

/** Helper to create a minimal operation with request body */
function operationWithBody(opts: {
  required?: boolean;
  schema?: object;
}): OperationObject {
  return {
    responses: {},
    requestBody: {
      required: opts.required ?? false,
      content: {
        "application/json": {
          schema: opts.schema ?? { type: "object" },
        },
      },
    },
  };
}

/** Create a mock request */
function mockRequest(
  url: string,
  opts?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Request {
  const init: RequestInit = {
    method: opts?.method ?? "GET",
    headers: opts?.headers ?? {},
  };
  if (opts?.body) {
    init.body = opts.body;
  }
  return new Request(url, init);
}

// =============================================================================
// Query Parameter Validation
// =============================================================================

Deno.test("Validator: accepts valid query parameters", async () => {
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
    { name: "limit", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=1&limit=10");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("Validator: rejects missing required query parameter", async () => {
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "page", required: true, schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0]?.path, "query.page");
});

Deno.test("Validator: rejects invalid query parameter type", async () => {
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=not-a-number");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "query.page"));
});

Deno.test("Validator: validates query parameter constraints", async () => {
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
  ]);

  // Valid
  const req1 = mockRequest("http://localhost/test?limit=50");
  const result1 = await validator.validateRequest(req1, operation, "/test", {});
  assertEquals(result1.valid, true);

  // Too low
  const req2 = mockRequest("http://localhost/test?limit=0");
  const result2 = await validator.validateRequest(req2, operation, "/test", {});
  assertEquals(result2.valid, false);

  // Too high
  const req3 = mockRequest("http://localhost/test?limit=500");
  const result3 = await validator.validateRequest(req3, operation, "/test", {});
  assertEquals(result3.valid, false);
});

Deno.test("Validator: strict mode rejects unknown query parameters", async () => {
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=1&unknown=value");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "query.unknown"));
});

Deno.test("Validator: unknown query parameters are reported as errors", async () => {
  // Validator always reports issues as errors - server decides whether to reject
  const validator = createValidator();
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=1&unknown=value");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false); // Validation fails, server decides action
  assertExists(result.errors.find((e) => e.path === "query.unknown"));
});

// =============================================================================
// Query Parameter Array Format Tests
// =============================================================================

Deno.test("Validator: queryArrayFormat=repeat parses repeated keys", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryArrayFormat: "repeat",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "colors",
        in: "query",
        schema: { type: "array", items: { type: "string" } },
      },
    ],
  };

  const req = mockRequest(
    "http://localhost/test?colors=red&colors=green&colors=blue",
  );
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: queryArrayFormat=comma parses comma-separated values", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryArrayFormat: "comma",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "colors",
        in: "query",
        schema: { type: "array", items: { type: "string" } },
      },
    ],
  };

  const req = mockRequest("http://localhost/test?colors=red,green,blue");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: queryArrayFormat=brackets parses bracket notation", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryArrayFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "colors",
        in: "query",
        schema: { type: "array", items: { type: "string" } },
      },
    ],
  };

  const req = mockRequest(
    "http://localhost/test?colors[]=red&colors[]=green&colors[]=blue",
  );
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

// =============================================================================
// Query Parameter Nested Format Tests
// =============================================================================

Deno.test("Validator: queryNestedFormat=brackets parses deepObject notation", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "user",
        in: "query",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
          required: ["name"],
        },
      },
    ],
  };

  const req = mockRequest("http://localhost/test?user[name]=sam&user[age]=30");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: queryNestedFormat=brackets validates nested object schema", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "user",
        in: "query",
        required: true,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
          required: ["name"],
        },
      },
    ],
  };

  // Missing required 'name' property
  const req = mockRequest("http://localhost/test?user[age]=30");
  const result = await validator.validateRequest(req, operation, "/test", {});

  // Should fail because 'name' is required
  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.message.includes("required")));
});

Deno.test("Validator: queryNestedFormat=brackets coerces property types", async () => {
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "filter",
        in: "query",
        schema: {
          type: "object",
          properties: {
            limit: { type: "integer" },
            active: { type: "boolean" },
          },
        },
      },
    ],
  };

  const req = mockRequest(
    "http://localhost/test?filter[limit]=10&filter[active]=true",
  );
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

// =============================================================================
// Path Parameter Validation
// =============================================================================

Deno.test("Validator: accepts valid path parameters", async () => {
  const validator = createValidator();
  const operation = operationWithPathParams([
    { name: "id", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/users/123");
  const result = await validator.validateRequest(
    req,
    operation,
    "/users/{id}",
    {
      id: "123",
    },
  );

  assertEquals(result.valid, true);
});

Deno.test("Validator: rejects invalid path parameter type", async () => {
  const validator = createValidator();
  const operation = operationWithPathParams([
    { name: "id", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/users/abc");
  const result = await validator.validateRequest(
    req,
    operation,
    "/users/{id}",
    {
      id: "abc",
    },
  );

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "path.id"));
});

Deno.test("Validator: handles string path parameters", async () => {
  const validator = createValidator();
  const operation = operationWithPathParams([
    { name: "slug", schema: { type: "string" } },
  ]);

  const req = mockRequest("http://localhost/posts/my-post-slug");
  const result = await validator.validateRequest(
    req,
    operation,
    "/posts/{slug}",
    { slug: "my-post-slug" },
  );

  assertEquals(result.valid, true);
});

// =============================================================================
// Header Validation
// =============================================================================

Deno.test("Validator: accepts valid headers", async () => {
  const validator = createValidator();
  const operation = operationWithHeaders([
    { name: "X-API-Key", required: true },
  ]);

  const req = mockRequest("http://localhost/test", {
    headers: { "X-API-Key": "secret-key" },
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: rejects missing required header", async () => {
  const validator = createValidator();
  const operation = operationWithHeaders([
    { name: "X-API-Key", required: true },
  ]);

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "header.X-API-Key"));
});

Deno.test("Validator: optional header not required", async () => {
  const validator = createValidator();
  const operation = operationWithHeaders([
    { name: "X-Request-ID", required: false },
  ]);

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

// =============================================================================
// Request Body Validation
// =============================================================================

Deno.test("Validator: accepts valid request body", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", age: 30 }),
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: rejects invalid request body", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: {
      type: "object",
      required: ["name", "email"],
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
    },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice" }), // Missing email
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path?.includes("body")));
});

Deno.test("Validator: rejects wrong content-type", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ name: "Alice" }),
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
});

Deno.test("Validator: rejects malformed JSON body", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid json }",
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "body"));
});

// =============================================================================
// Body Size Limits
// =============================================================================

Deno.test("Validator: rejects oversized content-length", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "999999999999", // > 10MB
    },
    body: "{}",
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.message?.includes("too large")));
});

Deno.test("Validator: rejects invalid content-length header", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "not-a-number",
    },
    body: "{}",
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(
    result.errors.find((e) => e.message?.includes("Invalid Content-Length")),
  );
});

// =============================================================================
// GET/HEAD with body (validate if spec defines it)
// =============================================================================

Deno.test("Validator: validates body for GET if spec defines it (missing body)", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
    },
  });

  // Missing required body - GET without body should fail if spec requires one
  const req = mockRequest("http://localhost/test", { method: "GET" });
  const result = await validator.validateRequest(req, operation, "/test", {});
  assertEquals(result.valid, false);
  // Note: Deno's Request API doesn't allow body on GET, so we can only test missing body case
});

Deno.test("Validator: validates body for HEAD if spec defines it", async () => {
  const validator = createValidator();
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  // Missing required body
  const req = mockRequest("http://localhost/test", { method: "HEAD" });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
});

// =============================================================================
// Empty Operation (no parameters)
// =============================================================================

Deno.test("Validator: handles operation with no parameters", async () => {
  const validator = createValidator();
  const operation: OperationObject = { responses: {} };

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

// =============================================================================
// Parameter $ref Resolution
// =============================================================================

Deno.test("Validator: resolves $ref parameters and validates them", async () => {
  // This is the Lithic SDK failure pattern: parameters defined via $ref
  // The bug: $ref parameters were filtered out, reported as "Unknown parameter"
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/transactions": {
        get: {
          responses: { "200": { description: "OK" } },
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { $ref: "#/components/parameters/beginTime" },
            { $ref: "#/components/parameters/pageSize" },
          ],
        },
      },
    },
    components: {
      parameters: {
        beginTime: {
          name: "begin",
          in: "query",
          schema: { type: "string", format: "date-time" },
        },
        pageSize: {
          name: "page_size",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const validator = new RequestValidator(registry);
  const operation = spec.paths["/transactions"].get as OperationObject;

  // Request with $ref-defined parameters should be valid
  const req = mockRequest(
    "http://localhost/transactions?status=active&begin=2024-01-01T00:00:00Z&page_size=10",
  );
  const result = await validator.validateRequest(
    req,
    operation,
    "/transactions",
    {},
  );

  // Should NOT report "begin" or "page_size" as unknown parameters
  const unknownParamErrors = result.errors.filter(
    (e) => e.message === "Unknown parameter",
  );
  assertEquals(
    unknownParamErrors.length,
    0,
    `Should not have unknown parameter errors, got: ${
      JSON.stringify(unknownParamErrors)
    }`,
  );
  assertEquals(result.valid, true);
});

Deno.test("Validator: handles unresolved parameter $ref gracefully", async () => {
  // When a parameter $ref points to a non-existent component, we should:
  // 1. Log a warning (tested via console output)
  // 2. Skip the parameter during validation (not crash)
  // 3. Continue validating other parameters
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          responses: { "200": { description: "OK" } },
          parameters: [
            { name: "valid", in: "query", schema: { type: "string" } },
            { $ref: "#/components/parameters/nonExistent" }, // This doesn't exist
          ],
        },
      },
    },
    components: {
      parameters: {}, // Empty - no parameters defined
    },
  };

  const registry = new SchemaRegistry(spec);
  const validator = new RequestValidator(registry);
  const operation = spec.paths["/test"].get as OperationObject;

  // Request should still work - the unresolved ref is skipped with a warning
  const req = mockRequest("http://localhost/test?valid=hello");
  const result = await validator.validateRequest(req, operation, "/test", {});

  // The valid parameter should be validated
  assertEquals(result.valid, true);
});

// =============================================================================
// Schema Reference Resolution Tests
// =============================================================================

Deno.test("Validator: resolves $ref in parameter schema for array type detection", async () => {
  // Test that array schemas defined via $ref are properly detected
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          responses: { "200": { description: "OK" } },
          parameters: [
            {
              name: "ids",
              in: "query",
              schema: { $ref: "#/components/schemas/IdArray" },
            },
          ],
        },
      },
    },
    components: {
      schemas: {
        IdArray: {
          type: "array",
          items: { type: "integer" },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const validator = new RequestValidator(registry, {
    queryArrayFormat: "repeat",
  });
  const operation = spec.paths["/test"].get as OperationObject;

  // Should recognize this as an array and parse correctly
  const req = mockRequest("http://localhost/test?ids=1&ids=2&ids=3");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: resolves $ref in parameter schema for object type detection", async () => {
  // Test that object schemas defined via $ref are properly detected
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          responses: { "200": { description: "OK" } },
          parameters: [
            {
              name: "filter",
              in: "query",
              schema: { $ref: "#/components/schemas/Filter" },
            },
          ],
        },
      },
    },
    components: {
      schemas: {
        Filter: {
          type: "object",
          properties: {
            status: { type: "string" },
            limit: { type: "integer" },
          },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation = spec.paths["/test"].get as OperationObject;

  // Should recognize this as an object and parse bracket notation correctly
  const req = mockRequest(
    "http://localhost/test?filter[status]=active&filter[limit]=10",
  );
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: detects object schema with only additionalProperties", async () => {
  // Object schemas can be defined with just additionalProperties (no explicit properties)
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "metadata",
        in: "query",
        schema: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
    ],
  };

  // Should recognize this as an object schema
  const req = mockRequest(
    "http://localhost/test?metadata[key1]=value1&metadata[key2]=value2",
  );
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: detects object schema with only patternProperties", async () => {
  // Object schemas can be defined with just patternProperties
  const registry = new SchemaRegistry({});
  const validator = new RequestValidator(registry, {
    queryNestedFormat: "brackets",
  });
  const operation: OperationObject = {
    responses: {},
    parameters: [
      {
        name: "dynamic",
        in: "query",
        schema: {
          type: "object",
          patternProperties: {
            "^x-": { type: "string" },
          },
        },
      },
    ],
  };

  // Should recognize this as an object schema
  const req = mockRequest("http://localhost/test?dynamic[x-custom]=value");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});
