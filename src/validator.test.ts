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
import type { OperationObject } from "@steady/parser";

/** Helper to create a minimal operation with query params */
function operationWithQueryParams(
  params: Array<{
    name: string;
    required?: boolean;
    schema?: { type: string; minimum?: number; maximum?: number };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "query" as const,
      required: p.required ?? false,
      schema: p.schema ?? { type: "string" },
    })),
  };
}

/** Helper to create a minimal operation with path params */
function operationWithPathParams(
  params: Array<{
    name: string;
    schema?: { type: string };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "path" as const,
      required: true,
      schema: p.schema ?? { type: "string" },
    })),
  };
}

/** Helper to create a minimal operation with header params */
function operationWithHeaders(
  params: Array<{
    name: string;
    required?: boolean;
    schema?: { type: string };
  }>,
): OperationObject {
  return {
    responses: {},
    parameters: params.map((p) => ({
      name: p.name,
      in: "header" as const,
      required: p.required ?? false,
      schema: p.schema ?? { type: "string" },
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=not-a-number");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "query.page"));
});

Deno.test("Validator: validates query parameter constraints", async () => {
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=1&unknown=value");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "query.unknown"));
});

Deno.test("Validator: relaxed mode warns on unknown query parameters", async () => {
  const validator = new RequestValidator("relaxed");
  const operation = operationWithQueryParams([
    { name: "page", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/test?page=1&unknown=value");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true); // Still valid in relaxed mode
  assertExists(result.warnings.find((w) => w.path === "query.unknown"));
});

// =============================================================================
// Path Parameter Validation
// =============================================================================

Deno.test("Validator: accepts valid path parameters", async () => {
  const validator = new RequestValidator("strict");
  const operation = operationWithPathParams([
    { name: "id", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/users/123");
  const result = await validator.validateRequest(req, operation, "/users/{id}", {
    id: "123",
  });

  assertEquals(result.valid, true);
});

Deno.test("Validator: rejects invalid path parameter type", async () => {
  const validator = new RequestValidator("strict");
  const operation = operationWithPathParams([
    { name: "id", schema: { type: "integer" } },
  ]);

  const req = mockRequest("http://localhost/users/abc");
  const result = await validator.validateRequest(req, operation, "/users/{id}", {
    id: "abc",
  });

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "path.id"));
});

Deno.test("Validator: handles string path parameters", async () => {
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
  const operation = operationWithHeaders([
    { name: "X-API-Key", required: true },
  ]);

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, false);
  assertExists(result.errors.find((e) => e.path === "header.X-API-Key"));
});

Deno.test("Validator: optional header not required", async () => {
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  const validator = new RequestValidator("strict");
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
  assertExists(result.errors.find((e) => e.message?.includes("Invalid Content-Length")));
});

// =============================================================================
// GET/HEAD should not validate body
// =============================================================================

Deno.test("Validator: ignores body for GET requests", async () => {
  const validator = new RequestValidator("strict");
  const operation = operationWithBody({
    required: true, // Even though required, GET should ignore
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "GET",
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

Deno.test("Validator: ignores body for HEAD requests", async () => {
  const validator = new RequestValidator("strict");
  const operation = operationWithBody({
    required: true,
    schema: { type: "object" },
  });

  const req = mockRequest("http://localhost/test", {
    method: "HEAD",
  });
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});

// =============================================================================
// Empty Operation (no parameters)
// =============================================================================

Deno.test("Validator: handles operation with no parameters", async () => {
  const validator = new RequestValidator("strict");
  const operation: OperationObject = { responses: {} };

  const req = mockRequest("http://localhost/test");
  const result = await validator.validateRequest(req, operation, "/test", {});

  assertEquals(result.valid, true);
});
