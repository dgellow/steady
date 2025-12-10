/**
 * Tests for form-parser.ts
 *
 * Tests URL-encoded and multipart form data parsing including:
 * - Basic field parsing
 * - Nested paths (dot and bracket notation)
 * - Array fields
 * - Type coercion
 * - File handling
 * - Media type utilities
 */

import { assertEquals } from "@std/assert";
import {
  getMediaType,
  isFormMediaType,
  isJsonMediaType,
  parseFormData,
  parseUrlEncoded,
} from "./form-parser.ts";

// =============================================================================
// parseUrlEncoded - Basic parsing
// =============================================================================

Deno.test("parseUrlEncoded: parses simple key-value pairs", () => {
  const result = parseUrlEncoded("name=sam&age=30");

  assertEquals(result.data, { name: "sam", age: "30" });
  assertEquals(result.files.size, 0);
});

Deno.test("parseUrlEncoded: handles empty input", () => {
  const result = parseUrlEncoded("");

  assertEquals(result.data, {});
  assertEquals(result.files.size, 0);
});

Deno.test("parseUrlEncoded: handles URL-encoded values", () => {
  const result = parseUrlEncoded(
    "message=hello%20world&email=user%40example.com",
  );

  assertEquals(result.data, {
    message: "hello world",
    email: "user@example.com",
  });
});

// =============================================================================
// parseUrlEncoded - Nested dot notation
// =============================================================================

Deno.test("parseUrlEncoded: parses nested dot notation", () => {
  const result = parseUrlEncoded("user.name=sam&user.email=sam@example.com", {
    nestedFormat: "dots",
  });

  assertEquals(result.data, {
    user: {
      name: "sam",
      email: "sam@example.com",
    },
  });
});

Deno.test("parseUrlEncoded: parses deeply nested dot notation", () => {
  const result = parseUrlEncoded(
    "user.address.city=NYC&user.address.zip=10001",
    {
      nestedFormat: "dots",
    },
  );

  assertEquals(result.data, {
    user: {
      address: {
        city: "NYC",
        zip: "10001",
      },
    },
  });
});

// =============================================================================
// parseUrlEncoded - Nested bracket notation
// =============================================================================

Deno.test("parseUrlEncoded: parses bracket notation", () => {
  const result = parseUrlEncoded("user[name]=sam&user[email]=sam@example.com", {
    nestedFormat: "brackets",
  });

  assertEquals(result.data, {
    user: {
      name: "sam",
      email: "sam@example.com",
    },
  });
});

Deno.test("parseUrlEncoded: parses deeply nested bracket notation", () => {
  const result = parseUrlEncoded(
    "user[address][city]=NYC&user[address][zip]=10001",
    {
      nestedFormat: "brackets",
    },
  );

  assertEquals(result.data, {
    user: {
      address: {
        city: "NYC",
        zip: "10001",
      },
    },
  });
});

Deno.test("parseUrlEncoded: parses array indices in bracket notation", () => {
  const result = parseUrlEncoded(
    "items[0]=first&items[1]=second&items[2]=third",
    {
      nestedFormat: "brackets",
    },
  );

  assertEquals(result.data, {
    items: ["first", "second", "third"],
  });
});

// =============================================================================
// parseUrlEncoded - Array fields (repeated keys)
// =============================================================================

Deno.test("parseUrlEncoded: handles repeated keys as arrays", () => {
  const result = parseUrlEncoded("tags=red&tags=green&tags=blue");

  assertEquals(result.data, {
    tags: ["red", "green", "blue"],
  });
});

Deno.test("parseUrlEncoded: single value remains as string without schema", () => {
  const result = parseUrlEncoded("tag=red");

  assertEquals(result.data, { tag: "red" });
});

// =============================================================================
// parseUrlEncoded - Type coercion with schema
// =============================================================================

Deno.test("parseUrlEncoded: coerces integer values with schema", () => {
  const result = parseUrlEncoded("count=42", {
    schema: {
      type: "object",
      properties: {
        count: { type: "integer" },
      },
    },
  });

  assertEquals(result.data, { count: 42 });
  assertEquals(typeof result.data.count, "number");
});

Deno.test("parseUrlEncoded: coerces number values with schema", () => {
  const result = parseUrlEncoded("price=19.99", {
    schema: {
      type: "object",
      properties: {
        price: { type: "number" },
      },
    },
  });

  assertEquals(result.data, { price: 19.99 });
  assertEquals(typeof result.data.price, "number");
});

Deno.test("parseUrlEncoded: coerces boolean true with schema", () => {
  const result = parseUrlEncoded("active=true", {
    schema: {
      type: "object",
      properties: {
        active: { type: "boolean" },
      },
    },
  });

  assertEquals(result.data, { active: true });
  assertEquals(typeof result.data.active, "boolean");
});

Deno.test("parseUrlEncoded: coerces boolean false with schema", () => {
  const result = parseUrlEncoded("active=false", {
    schema: {
      type: "object",
      properties: {
        active: { type: "boolean" },
      },
    },
  });

  assertEquals(result.data, { active: false });
  assertEquals(typeof result.data.active, "boolean");
});

Deno.test("parseUrlEncoded: invalid boolean stays as string", () => {
  const result = parseUrlEncoded("active=yes", {
    schema: {
      type: "object",
      properties: {
        active: { type: "boolean" },
      },
    },
  });

  assertEquals(result.data, { active: "yes" });
  assertEquals(typeof result.data.active, "string");
});

Deno.test("parseUrlEncoded: handles nested schema for type coercion", () => {
  const result = parseUrlEncoded("user.age=30&user.active=true", {
    nestedFormat: "dots",
    schema: {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            age: { type: "integer" },
            active: { type: "boolean" },
          },
        },
      },
    },
  });

  assertEquals(result.data, {
    user: {
      age: 30,
      active: true,
    },
  });
});

// =============================================================================
// parseFormData - Basic parsing
// =============================================================================

Deno.test("parseFormData: parses simple form data", () => {
  const formData = new FormData();
  formData.append("name", "sam");
  formData.append("email", "sam@example.com");

  const result = parseFormData(formData);

  assertEquals(result.data, {
    name: "sam",
    email: "sam@example.com",
  });
  assertEquals(result.files.size, 0);
});

Deno.test("parseFormData: handles empty form data", () => {
  const formData = new FormData();

  const result = parseFormData(formData);

  assertEquals(result.data, {});
  assertEquals(result.files.size, 0);
});

Deno.test("parseFormData: handles repeated fields as arrays", () => {
  const formData = new FormData();
  formData.append("tags", "red");
  formData.append("tags", "green");
  formData.append("tags", "blue");

  const result = parseFormData(formData);

  assertEquals(result.data, {
    tags: ["red", "green", "blue"],
  });
});

// =============================================================================
// parseFormData - Nested paths
// =============================================================================

Deno.test("parseFormData: parses nested dot notation", () => {
  const formData = new FormData();
  formData.append("user.name", "sam");
  formData.append("user.email", "sam@example.com");

  const result = parseFormData(formData, { nestedFormat: "dots" });

  assertEquals(result.data, {
    user: {
      name: "sam",
      email: "sam@example.com",
    },
  });
});

Deno.test("parseFormData: parses nested bracket notation", () => {
  const formData = new FormData();
  formData.append("user[name]", "sam");
  formData.append("user[email]", "sam@example.com");

  const result = parseFormData(formData, { nestedFormat: "brackets" });

  assertEquals(result.data, {
    user: {
      name: "sam",
      email: "sam@example.com",
    },
  });
});

// =============================================================================
// parseFormData - File handling
// =============================================================================

Deno.test("parseFormData: handles file uploads", () => {
  const formData = new FormData();
  formData.append("name", "document");
  const file = new File(["test content"], "test.txt", { type: "text/plain" });
  formData.append("attachment", file);

  const result = parseFormData(formData);

  assertEquals(result.data.name, "document");
  assertEquals(result.data.attachment, "[File]");
  assertEquals(result.files.size, 1);
  assertEquals(result.files.get("attachment"), file);
});

Deno.test("parseFormData: handles multiple file uploads", () => {
  const formData = new FormData();
  const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
  const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });
  formData.append("files", file1);
  formData.append("files", file2);

  const result = parseFormData(formData);

  assertEquals(result.data.files, ["[File]", "[File]"]);
  assertEquals(result.files.size, 1);

  const uploadedFiles = result.files.get("files");
  assertEquals(Array.isArray(uploadedFiles), true);
  assertEquals((uploadedFiles as File[]).length, 2);
});

// =============================================================================
// parseFormData - Type coercion
// =============================================================================

Deno.test("parseFormData: coerces types with schema", () => {
  const formData = new FormData();
  formData.append("count", "42");
  formData.append("active", "true");
  formData.append("price", "19.99");

  const result = parseFormData(formData, {
    schema: {
      type: "object",
      properties: {
        count: { type: "integer" },
        active: { type: "boolean" },
        price: { type: "number" },
      },
    },
  });

  assertEquals(result.data, {
    count: 42,
    active: true,
    price: 19.99,
  });
});

// =============================================================================
// getMediaType
// =============================================================================

Deno.test("getMediaType: extracts media type without parameters", () => {
  assertEquals(getMediaType("application/json"), "application/json");
});

Deno.test("getMediaType: strips charset parameter", () => {
  assertEquals(
    getMediaType("application/json; charset=utf-8"),
    "application/json",
  );
});

Deno.test("getMediaType: strips boundary parameter", () => {
  assertEquals(
    getMediaType("multipart/form-data; boundary=----WebKitFormBoundary"),
    "multipart/form-data",
  );
});

Deno.test("getMediaType: handles empty input", () => {
  assertEquals(getMediaType(""), "application/json");
});

Deno.test("getMediaType: handles multiple parameters", () => {
  assertEquals(
    getMediaType("text/html; charset=utf-8; boundary=something"),
    "text/html",
  );
});

// =============================================================================
// isFormMediaType
// =============================================================================

Deno.test("isFormMediaType: returns true for multipart/form-data", () => {
  assertEquals(isFormMediaType("multipart/form-data"), true);
});

Deno.test("isFormMediaType: returns true for application/x-www-form-urlencoded", () => {
  assertEquals(isFormMediaType("application/x-www-form-urlencoded"), true);
});

Deno.test("isFormMediaType: returns false for application/json", () => {
  assertEquals(isFormMediaType("application/json"), false);
});

Deno.test("isFormMediaType: returns false for text/plain", () => {
  assertEquals(isFormMediaType("text/plain"), false);
});

// =============================================================================
// isJsonMediaType
// =============================================================================

Deno.test("isJsonMediaType: returns true for application/json", () => {
  assertEquals(isJsonMediaType("application/json"), true);
});

Deno.test("isJsonMediaType: returns true for vendor+json types", () => {
  assertEquals(isJsonMediaType("application/vnd.api+json"), true);
});

Deno.test("isJsonMediaType: returns true for problem+json", () => {
  assertEquals(isJsonMediaType("application/problem+json"), true);
});

Deno.test("isJsonMediaType: returns false for application/xml", () => {
  assertEquals(isJsonMediaType("application/xml"), false);
});

Deno.test("isJsonMediaType: returns false for text/plain", () => {
  assertEquals(isJsonMediaType("text/plain"), false);
});

// =============================================================================
// Edge cases
// =============================================================================

Deno.test("parseUrlEncoded: handles mixed nested formats", () => {
  // When format is 'dots', brackets are treated literally
  const result = parseUrlEncoded("user.info[0]=test", {
    nestedFormat: "dots",
  });

  assertEquals(result.data, {
    user: {
      "info[0]": "test",
    },
  });
});

Deno.test("parseUrlEncoded: creates null-prototype objects", () => {
  const result = parseUrlEncoded("name=sam");

  // Should not have Object.prototype methods on the result
  assertEquals(Object.getPrototypeOf(result.data), null);
});

console.log("Form parser tests loaded");
