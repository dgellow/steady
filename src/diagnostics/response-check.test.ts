import { assertEquals } from "@std/assert";
import { isMinimalResponse } from "./response-check.ts";

Deno.test("isMinimalResponse - empty object with required fields is minimal", () => {
  const result = isMinimalResponse({}, {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  });
  assertEquals(result, true);
});

Deno.test("isMinimalResponse - empty array body with schema expecting properties is minimal", () => {
  const result = isMinimalResponse([], {
    type: "object",
    properties: { x: { type: "string" } },
  });
  assertEquals(result, true);
});

Deno.test("isMinimalResponse - populated object with required fields is not minimal", () => {
  const result = isMinimalResponse({ name: "Sam" }, {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - empty object with $ref-only schema returns false", () => {
  const result = isMinimalResponse({}, { $ref: "#/components/schemas/User" });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - empty object with no properties or required returns false", () => {
  const result = isMinimalResponse({}, { type: "object" });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - null body returns false", () => {
  const result = isMinimalResponse(null, {
    type: "object",
    required: ["id"],
  });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - undefined body returns false", () => {
  const result = isMinimalResponse(undefined, {
    type: "object",
    required: ["id"],
  });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - empty object with empty required array returns false", () => {
  const result = isMinimalResponse({}, {
    type: "object",
    required: [],
    properties: {},
  });
  assertEquals(result, false);
});

Deno.test("isMinimalResponse - empty object with properties but no required is minimal", () => {
  const result = isMinimalResponse({}, {
    type: "object",
    properties: { name: { type: "string" }, email: { type: "string" } },
  });
  assertEquals(result, true);
});
