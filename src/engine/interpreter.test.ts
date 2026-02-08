import { assertEquals } from "@std/assert";
import type { Schema } from "@steady/json-schema";
import type { SpecResolver, ValidationNode } from "./types.ts";
import { interpret, resolveDataAtPath } from "./interpreter.ts";

/**
 * Stub spec resolver — returns the schema associated with the given path.
 * Tests register schemas by pointer, and the interpreter looks them up.
 */
function makeResolver(schemas: Record<string, Schema>): SpecResolver {
  return {
    resolve(schemaPath: string): Schema {
      const schema = schemas[schemaPath];
      if (!schema) {
        throw new Error(`Test resolver: no schema for "${schemaPath}"`);
      }
      return schema;
    },
  };
}

Deno.test("interpret", async (t) => {
  // ── Valid nodes ────────────────────────────────────────────────────

  await t.step("valid node → no diagnostics, structurally valid", () => {
    const node: ValidationNode = {
      valid: true,
      path: "body",
      schemaPath: "#/schema",
    };

    const result = interpret(node, makeResolver({}), "body", {});

    assertEquals(result.diagnostics, []);
    assertEquals(result.structurallyValid, true);
    assertEquals(result.structuralFailureCount, 0);
  });

  // ── Leaf nodes ─────────────────────────────────────────────────────

  await t.step("structural leaf → one diagnostic, structurally invalid", () => {
    const node: ValidationNode = {
      valid: false,
      keyword: "required",
      path: "body.name",
      schemaPath: "#/properties/name",
      field: "name",
    };

    const resolver = makeResolver({
      "#/properties/name": {},
    });

    const result = interpret(node, resolver, "body", {});

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E3007");
    assertEquals(result.structurallyValid, false);
    assertEquals(result.structuralFailureCount, 1);
  });

  await t.step("content leaf → one diagnostic, structurally valid", () => {
    const node: ValidationNode = {
      valid: false,
      keyword: "pattern",
      path: "body.email",
      schemaPath: "#/properties/email",
    };

    const resolver = makeResolver({
      "#/properties/email": { pattern: "^.+@.+$" },
    });

    const result = interpret(node, resolver, "body", {});

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.structurallyValid, true);
    assertEquals(result.structuralFailureCount, 0);
  });

  // ── Container nodes (no composition keyword) ──────────────────────

  await t.step("container with mixed children → merges results", () => {
    const node: ValidationNode = {
      valid: false,
      path: "body",
      schemaPath: "#/schema",
      children: [
        {
          valid: false,
          keyword: "required",
          path: "body.name",
          schemaPath: "#/properties/name",
          field: "name",
        },
        {
          valid: false,
          keyword: "pattern",
          path: "body.email",
          schemaPath: "#/properties/email",
        },
      ],
    };

    const resolver = makeResolver({
      "#/properties/name": {},
      "#/properties/email": { pattern: "^.+@.+$" },
    });

    const result = interpret(node, resolver, "body", {});

    assertEquals(result.diagnostics.length, 2);
    assertEquals(result.diagnostics[0]!.code, "E3007");
    assertEquals(result.diagnostics[1]!.code, "E4002");
    // One structural failure (required) makes it structurally invalid
    assertEquals(result.structurallyValid, false);
    assertEquals(result.structuralFailureCount, 1);
  });

  await t.step(
    "container with all content children → structurally valid",
    () => {
      const node: ValidationNode = {
        valid: false,
        path: "body",
        schemaPath: "#/schema",
        children: [
          {
            valid: false,
            keyword: "pattern",
            path: "body.name",
            schemaPath: "#/properties/name",
          },
          {
            valid: false,
            keyword: "minLength",
            path: "body.email",
            schemaPath: "#/properties/email",
          },
        ],
      };

      const resolver = makeResolver({
        "#/properties/name": {},
        "#/properties/email": {},
      });

      const result = interpret(node, resolver, "body", {});

      assertEquals(result.diagnostics.length, 2);
      assertEquals(result.structurallyValid, true);
      assertEquals(result.structuralFailureCount, 0);
    },
  );

  // ── Composition nodes ─────────────────────────────────────────────

  await t.step("oneOf composition → delegates to attributeOneOf", () => {
    // Two variants: first structurally matches with a content error,
    // second structurally fails
    const node: ValidationNode = {
      valid: false,
      keyword: "oneOf",
      path: "body",
      schemaPath: "#/schema/oneOf",
      children: [
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/oneOf/0",
          variantIndex: 0,
          children: [
            {
              valid: false,
              keyword: "pattern",
              path: "body.card_number",
              schemaPath: "#/schema/oneOf/0/properties/card_number",
            },
          ],
        },
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/oneOf/1",
          variantIndex: 1,
          children: [
            {
              valid: false,
              keyword: "required",
              path: "body.account",
              schemaPath: "#/schema/oneOf/1/properties/account",
              field: "account",
            },
          ],
        },
      ],
    };

    const resolver = makeResolver({
      "#/schema/oneOf": {},
      "#/schema/oneOf/0/properties/card_number": {},
      "#/schema/oneOf/1/properties/account": {},
    });

    const result = interpret(node, resolver, "body", {});

    // oneOf: variant 0 structurally matches (pattern is content),
    // variant 1 doesn't (required is structural). Returns variant 0.
    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.structurallyValid, true);
  });

  await t.step("allOf composition → merges all children", () => {
    const node: ValidationNode = {
      valid: false,
      keyword: "allOf",
      path: "body",
      schemaPath: "#/schema/allOf",
      children: [
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/allOf/0",
          children: [
            {
              valid: false,
              keyword: "required",
              path: "body.name",
              schemaPath: "#/schema/allOf/0/properties/name",
              field: "name",
            },
          ],
        },
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/allOf/1",
          children: [
            {
              valid: false,
              keyword: "pattern",
              path: "body.role",
              schemaPath: "#/schema/allOf/1/properties/role",
            },
          ],
        },
      ],
    };

    const resolver = makeResolver({
      "#/schema/allOf": {},
      "#/schema/allOf/0/properties/name": {},
      "#/schema/allOf/1/properties/role": {},
    });

    const result = interpret(node, resolver, "body", {});

    assertEquals(result.diagnostics.length, 2);
    assertEquals(result.structurallyValid, false);
    assertEquals(result.structuralFailureCount, 1);
  });

  await t.step("anyOf composition → structural match wins", () => {
    const node: ValidationNode = {
      valid: false,
      keyword: "anyOf",
      path: "body",
      schemaPath: "#/schema/anyOf",
      children: [
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/anyOf/0",
          variantIndex: 0,
          children: [
            {
              valid: false,
              keyword: "pattern",
              path: "body.value",
              schemaPath: "#/schema/anyOf/0/properties/value",
            },
          ],
        },
        {
          valid: false,
          path: "body",
          schemaPath: "#/schema/anyOf/1",
          variantIndex: 1,
          children: [
            {
              valid: false,
              keyword: "required",
              path: "body.other",
              schemaPath: "#/schema/anyOf/1/properties/other",
              field: "other",
            },
          ],
        },
      ],
    };

    const resolver = makeResolver({
      "#/schema/anyOf": {},
      "#/schema/anyOf/0/properties/value": {},
      "#/schema/anyOf/1/properties/other": {},
    });

    const result = interpret(node, resolver, "body", {});

    // anyOf: variant 0 structurally matches (pattern is content)
    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E4002");
    assertEquals(result.structurallyValid, true);
  });

  // ── Discriminator with data ────────────────────────────────────────

  await t.step(
    "oneOf with discriminator uses request data to select variant",
    () => {
      const node: ValidationNode = {
        valid: false,
        keyword: "oneOf",
        path: "body",
        schemaPath: "#/schema/oneOf",
        children: [
          {
            valid: false,
            path: "body",
            schemaPath: "#/schema/oneOf/0",
            variantIndex: 0,
            children: [
              {
                valid: false,
                keyword: "pattern",
                path: "body.card_number",
                schemaPath: "#/schema/oneOf/0/properties/card_number",
              },
            ],
          },
          {
            valid: false,
            path: "body",
            schemaPath: "#/schema/oneOf/1",
            variantIndex: 1,
            children: [
              {
                valid: false,
                keyword: "required",
                path: "body.account",
                schemaPath: "#/schema/oneOf/1/properties/account",
                field: "account",
              },
            ],
          },
        ],
      };

      const oneOfSchema: Schema = {
        discriminator: { propertyName: "type" },
        oneOf: [
          { properties: { type: { const: "card" } } },
          { properties: { type: { const: "bank" } } },
        ],
      };

      const resolver = makeResolver({
        "#/schema/oneOf": oneOfSchema,
        "#/schema/oneOf/0/properties/card_number": {},
        "#/schema/oneOf/1/properties/account": {},
      });

      // data has type: "card" → selects variant 0
      const data = { type: "card", card_number: "bad" };
      const result = interpret(node, resolver, "body", data);

      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E4002");
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
    },
  );

  // ── Nested composition ────────────────────────────────────────────

  await t.step("deeply nested: container wrapping leaf", () => {
    const node: ValidationNode = {
      valid: false,
      path: "body",
      schemaPath: "#/schema",
      children: [
        {
          valid: false,
          path: "body.address",
          schemaPath: "#/schema/properties/address",
          children: [
            {
              valid: false,
              keyword: "required",
              path: "body.address.street",
              schemaPath: "#/schema/properties/address/properties/street",
              field: "street",
            },
          ],
        },
      ],
    };

    const resolver = makeResolver({
      "#/schema/properties/address/properties/street": {},
    });

    const result = interpret(node, resolver, "body", {});

    assertEquals(result.diagnostics.length, 1);
    assertEquals(result.diagnostics[0]!.code, "E3007");
    assertEquals(result.diagnostics[0]!.requestPath, "body.address.street");
    assertEquals(result.structurallyValid, false);
  });
});

Deno.test("resolveDataAtPath", async (t) => {
  await t.step("path equals location → returns full data", () => {
    const data = { name: "Alice", type: "card" };
    assertEquals(resolveDataAtPath(data, "body", "body"), data);
  });

  await t.step("strips location prefix and navigates into data", () => {
    const data = { payment: { type: "card", amount: 100 } };
    assertEquals(resolveDataAtPath(data, "body.payment", "body"), data.payment);
  });

  await t.step("deep path navigation", () => {
    const data = { a: { b: { c: "deep" } } };
    assertEquals(resolveDataAtPath(data, "body.a.b.c", "body"), "deep");
  });

  await t.step("missing intermediate key → returns undefined", () => {
    const data = { name: "Alice" };
    assertEquals(
      resolveDataAtPath(data, "body.payment.type", "body"),
      undefined,
    );
  });

  await t.step("non-object data → returns undefined for nested path", () => {
    assertEquals(resolveDataAtPath("string", "body.name", "body"), undefined);
  });

  await t.step("null data → returns undefined for nested path", () => {
    assertEquals(resolveDataAtPath(null, "body.name", "body"), undefined);
  });

  await t.step("non-body location", () => {
    const data = { limit: "10" };
    assertEquals(resolveDataAtPath(data, "query.limit", "query"), "10");
  });

  await t.step("path without location prefix → returns full data", () => {
    // This shouldn't happen in practice (path always starts with location),
    // but if it does, returning the full data is the safest fallback
    const data = { x: 1 };
    assertEquals(resolveDataAtPath(data, "other.x", "body"), data);
  });
});
