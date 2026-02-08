import { assertEquals } from "@std/assert";
import { isStructural } from "./structural.ts";
import type { Schema } from "@steady/json-schema";

const EMPTY_SCHEMA: Schema = {};

Deno.test("isStructural", async (t) => {
  // ── Always structural ───────────────────────────────────────────────

  await t.step("type is always structural", () => {
    assertEquals(isStructural("type", EMPTY_SCHEMA), true);
  });

  await t.step("required is always structural", () => {
    assertEquals(isStructural("required", EMPTY_SCHEMA), true);
  });

  await t.step("enum is always structural", () => {
    assertEquals(isStructural("enum", EMPTY_SCHEMA), true);
  });

  await t.step("const is always structural", () => {
    assertEquals(isStructural("const", EMPTY_SCHEMA), true);
  });

  // ── Always content ──────────────────────────────────────────────────

  await t.step("pattern is always content", () => {
    assertEquals(isStructural("pattern", EMPTY_SCHEMA), false);
  });

  await t.step("minLength is always content", () => {
    assertEquals(isStructural("minLength", EMPTY_SCHEMA), false);
  });

  await t.step("maxLength is always content", () => {
    assertEquals(isStructural("maxLength", EMPTY_SCHEMA), false);
  });

  await t.step("minimum is always content", () => {
    assertEquals(isStructural("minimum", EMPTY_SCHEMA), false);
  });

  await t.step("maximum is always content", () => {
    assertEquals(isStructural("maximum", EMPTY_SCHEMA), false);
  });

  await t.step("exclusiveMinimum is always content", () => {
    assertEquals(isStructural("exclusiveMinimum", EMPTY_SCHEMA), false);
  });

  await t.step("exclusiveMaximum is always content", () => {
    assertEquals(isStructural("exclusiveMaximum", EMPTY_SCHEMA), false);
  });

  await t.step("minItems is always content", () => {
    assertEquals(isStructural("minItems", EMPTY_SCHEMA), false);
  });

  await t.step("maxItems is always content", () => {
    assertEquals(isStructural("maxItems", EMPTY_SCHEMA), false);
  });

  await t.step("multipleOf is always content", () => {
    assertEquals(isStructural("multipleOf", EMPTY_SCHEMA), false);
  });

  await t.step("minProperties is always content", () => {
    assertEquals(isStructural("minProperties", EMPTY_SCHEMA), false);
  });

  await t.step("maxProperties is always content", () => {
    assertEquals(isStructural("maxProperties", EMPTY_SCHEMA), false);
  });

  await t.step("uniqueItems is always content", () => {
    assertEquals(isStructural("uniqueItems", EMPTY_SCHEMA), false);
  });

  // ── format: split by value ──────────────────────────────────────────

  await t.step("format binary is structural", () => {
    assertEquals(isStructural("format", { format: "binary" }), true);
  });

  await t.step("format byte is structural", () => {
    assertEquals(isStructural("format", { format: "byte" }), true);
  });

  await t.step("format email is content", () => {
    assertEquals(isStructural("format", { format: "email" }), false);
  });

  await t.step("format uri is content", () => {
    assertEquals(isStructural("format", { format: "uri" }), false);
  });

  await t.step("format uuid is content", () => {
    assertEquals(isStructural("format", { format: "uuid" }), false);
  });

  await t.step("format date-time is content", () => {
    assertEquals(isStructural("format", { format: "date-time" }), false);
  });

  await t.step("format with no value is content", () => {
    assertEquals(isStructural("format", EMPTY_SCHEMA), false);
  });

  // ── additionalProperties: context-dependent ─────────────────────────

  await t.step("additionalProperties explicitly false is structural", () => {
    assertEquals(
      isStructural("additionalProperties", {
        additionalProperties: false,
      }),
      true,
    );
  });

  await t.step("additionalProperties with schema is not structural", () => {
    assertEquals(
      isStructural("additionalProperties", {
        additionalProperties: { type: "string" },
      }),
      false,
    );
  });

  await t.step(
    "additionalProperties absent (spec silent) is not structural",
    () => {
      assertEquals(isStructural("additionalProperties", EMPTY_SCHEMA), false);
    },
  );

  // ── Unknown keywords ────────────────────────────────────────────────

  await t.step("unknown keyword defaults to not structural", () => {
    assertEquals(isStructural("foobar", EMPTY_SCHEMA), false);
  });
});
