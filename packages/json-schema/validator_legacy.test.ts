import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { JsonSchemaValidator } from "./validator.ts";
import type { Schema, ValidationResult } from "./types.ts";

function assertValid(result: ValidationResult, message?: string) {
  assertEquals(result.valid, true, message || "Expected validation to pass");
  assertEquals(
    result.errors.length,
    0,
    message || "Expected no validation errors",
  );
}

function assertInvalid(
  result: ValidationResult,
  expectedErrors: { keyword: string; instancePath?: string }[],
  message?: string,
) {
  assertEquals(result.valid, false, message || "Expected validation to fail");
  assertEquals(
    result.errors.length,
    expectedErrors.length,
    message ||
      `Expected ${expectedErrors.length} errors, got ${result.errors.length}`,
  );

  expectedErrors.forEach((expected, i) => {
    const actual = result.errors[i];
    assertEquals(
      actual?.keyword,
      expected.keyword,
      `Error ${i}: keyword mismatch`,
    );
    if (expected.instancePath !== undefined) {
      assertEquals(
        actual?.instancePath,
        expected.instancePath,
        `Error ${i}: instancePath mismatch`,
      );
    }
  });
}

Deno.test("JsonSchemaValidator - type validation", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates string type", () => {
    const schema: Schema = { type: "string" };

    assertValid(validator.validate(schema, "hello"));
    assertValid(validator.validate(schema, ""));
    assertInvalid(validator.validate(schema, 123), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, null), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, {}), [{ keyword: "type" }]);
  });

  await t.step("validates number type", () => {
    const schema: Schema = { type: "number" };

    assertValid(validator.validate(schema, 123));
    assertValid(validator.validate(schema, 123.45));
    assertValid(validator.validate(schema, 0));
    assertValid(validator.validate(schema, -123));
    assertInvalid(validator.validate(schema, "123"), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, null), [{ keyword: "type" }]);
  });

  await t.step("validates integer type", () => {
    const schema: Schema = { type: "integer" };

    assertValid(validator.validate(schema, 123));
    assertValid(validator.validate(schema, 0));
    assertValid(validator.validate(schema, -123));
    assertInvalid(validator.validate(schema, 123.45), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, "123"), [{ keyword: "type" }]);
  });

  await t.step("validates boolean type", () => {
    const schema: Schema = { type: "boolean" };

    assertValid(validator.validate(schema, true));
    assertValid(validator.validate(schema, false));
    assertInvalid(validator.validate(schema, 1), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, "true"), [{ keyword: "type" }]);
  });

  await t.step("validates array type", () => {
    const schema: Schema = { type: "array" };

    assertValid(validator.validate(schema, []));
    assertValid(validator.validate(schema, [1, 2, 3]));
    assertValid(validator.validate(schema, ["a", "b", "c"]));
    assertInvalid(validator.validate(schema, {}), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, "array"), [{ keyword: "type" }]);
  });

  await t.step("validates object type", () => {
    const schema: Schema = { type: "object" };

    assertValid(validator.validate(schema, {}));
    assertValid(validator.validate(schema, { foo: "bar" }));
    assertInvalid(validator.validate(schema, []), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, "object"), [{ keyword: "type" }]);
  });

  await t.step("validates null type", () => {
    const schema: Schema = { type: "null" };

    assertValid(validator.validate(schema, null));
    assertInvalid(validator.validate(schema, undefined), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, 0), [{ keyword: "type" }]);
  });

  await t.step("validates multiple types", () => {
    const schema: Schema = { type: ["string", "number"] };

    assertValid(validator.validate(schema, "hello"));
    assertValid(validator.validate(schema, 123));
    assertInvalid(validator.validate(schema, true), [{ keyword: "type" }]);
    assertInvalid(validator.validate(schema, null), [{ keyword: "type" }]);
  });
});

Deno.test("JsonSchemaValidator - string validation", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates minLength", () => {
    const schema: Schema = { type: "string", minLength: 3 };

    assertValid(validator.validate(schema, "abc"));
    assertValid(validator.validate(schema, "abcd"));
    assertInvalid(validator.validate(schema, "ab"), [{ keyword: "minLength" }]);
    assertInvalid(validator.validate(schema, ""), [{ keyword: "minLength" }]);
  });

  await t.step("validates maxLength", () => {
    const schema: Schema = { type: "string", maxLength: 5 };

    assertValid(validator.validate(schema, ""));
    assertValid(validator.validate(schema, "abcde"));
    assertInvalid(validator.validate(schema, "abcdef"), [{
      keyword: "maxLength",
    }]);
  });

  await t.step("validates pattern", () => {
    const schema: Schema = { type: "string", pattern: "^[a-z]+$" };

    assertValid(validator.validate(schema, "abc"));
    assertValid(validator.validate(schema, "xyz"));
    assertInvalid(validator.validate(schema, "ABC"), [{ keyword: "pattern" }]);
    assertInvalid(validator.validate(schema, "123"), [{ keyword: "pattern" }]);
    assertInvalid(validator.validate(schema, ""), [{ keyword: "pattern" }]);
  });

  await t.step("validates format - email", () => {
    const schema: Schema = { type: "string", format: "email" };

    assertValid(validator.validate(schema, "test@example.com"));
    assertValid(validator.validate(schema, "user.name@company.co.uk"));
    assertInvalid(validator.validate(schema, "not-an-email"), [{
      keyword: "format",
    }]);
    assertInvalid(validator.validate(schema, "@example.com"), [{
      keyword: "format",
    }]);
  });

  await t.step("validates format - uri", () => {
    const schema: Schema = { type: "string", format: "uri" };

    assertValid(validator.validate(schema, "https://example.com"));
    assertValid(validator.validate(schema, "http://example.com/path"));
    assertInvalid(validator.validate(schema, "not-a-uri"), [{
      keyword: "format",
    }]);
    assertInvalid(validator.validate(schema, "ftp://example.com"), [{
      keyword: "format",
    }]);
  });

  await t.step("validates format - date", () => {
    const schema: Schema = { type: "string", format: "date" };

    assertValid(validator.validate(schema, "2023-12-25"));
    assertInvalid(validator.validate(schema, "2023-13-01"), [{
      keyword: "format",
    }]);
    assertInvalid(validator.validate(schema, "25-12-2023"), [{
      keyword: "format",
    }]);
  });

  await t.step("validates format - uuid", () => {
    const schema: Schema = { type: "string", format: "uuid" };

    assertValid(
      validator.validate(schema, "123e4567-e89b-12d3-a456-426614174000"),
    );
    assertValid(
      validator.validate(schema, "00000000-0000-0000-0000-000000000000"),
    );
    assertInvalid(validator.validate(schema, "not-a-uuid"), [{
      keyword: "format",
    }]);
    assertInvalid(validator.validate(schema, "123e4567-e89b-12d3-a456"), [{
      keyword: "format",
    }]);
  });
});

Deno.test("JsonSchemaValidator - number validation", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates minimum", () => {
    const schema: Schema = { type: "number", minimum: 5 };

    assertValid(validator.validate(schema, 5));
    assertValid(validator.validate(schema, 10));
    assertInvalid(validator.validate(schema, 4), [{ keyword: "minimum" }]);
    assertInvalid(validator.validate(schema, -5), [{ keyword: "minimum" }]);
  });

  await t.step("validates maximum", () => {
    const schema: Schema = { type: "number", maximum: 10 };

    assertValid(validator.validate(schema, 10));
    assertValid(validator.validate(schema, 5));
    assertInvalid(validator.validate(schema, 11), [{ keyword: "maximum" }]);
    assertInvalid(validator.validate(schema, 100), [{ keyword: "maximum" }]);
  });

  await t.step("validates exclusiveMinimum", () => {
    const schema: Schema = { type: "number", exclusiveMinimum: 5 };

    assertValid(validator.validate(schema, 5.1));
    assertValid(validator.validate(schema, 10));
    assertInvalid(validator.validate(schema, 5), [{
      keyword: "exclusiveMinimum",
    }]);
    assertInvalid(validator.validate(schema, 4), [{
      keyword: "exclusiveMinimum",
    }]);
  });

  await t.step("validates exclusiveMaximum", () => {
    const schema: Schema = { type: "number", exclusiveMaximum: 10 };

    assertValid(validator.validate(schema, 9.9));
    assertValid(validator.validate(schema, 5));
    assertInvalid(validator.validate(schema, 10), [{
      keyword: "exclusiveMaximum",
    }]);
    assertInvalid(validator.validate(schema, 11), [{
      keyword: "exclusiveMaximum",
    }]);
  });

  await t.step("validates multipleOf", () => {
    const schema: Schema = { type: "number", multipleOf: 3 };

    assertValid(validator.validate(schema, 0));
    assertValid(validator.validate(schema, 3));
    assertValid(validator.validate(schema, 9));
    assertInvalid(validator.validate(schema, 4), [{ keyword: "multipleOf" }]);
    assertInvalid(validator.validate(schema, 5), [{ keyword: "multipleOf" }]);
  });
});

Deno.test("JsonSchemaValidator - array validation", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates minItems", () => {
    const schema: Schema = { type: "array", minItems: 2 };

    assertValid(validator.validate(schema, [1, 2]));
    assertValid(validator.validate(schema, [1, 2, 3]));
    assertInvalid(validator.validate(schema, [1]), [{ keyword: "minItems" }]);
    assertInvalid(validator.validate(schema, []), [{ keyword: "minItems" }]);
  });

  await t.step("validates maxItems", () => {
    const schema: Schema = { type: "array", maxItems: 3 };

    assertValid(validator.validate(schema, []));
    assertValid(validator.validate(schema, [1, 2, 3]));
    assertInvalid(validator.validate(schema, [1, 2, 3, 4]), [{
      keyword: "maxItems",
    }]);
  });

  await t.step("validates uniqueItems", () => {
    const schema: Schema = { type: "array", uniqueItems: true };

    assertValid(validator.validate(schema, []));
    assertValid(validator.validate(schema, [1, 2, 3]));
    assertValid(validator.validate(schema, ["a", "b", "c"]));
    assertInvalid(validator.validate(schema, [1, 2, 2]), [{
      keyword: "uniqueItems",
      instancePath: "/2",
    }]);
    assertInvalid(validator.validate(schema, ["a", "b", "a"]), [{
      keyword: "uniqueItems",
      instancePath: "/2",
    }]);
  });

  await t.step("validates items schema", () => {
    const schema: Schema = {
      type: "array",
      items: { type: "string" },
    };

    assertValid(validator.validate(schema, []));
    assertValid(validator.validate(schema, ["a", "b", "c"]));
    assertInvalid(validator.validate(schema, ["a", 1, "c"]), [{
      keyword: "type",
      instancePath: "/1",
    }]);
    assertInvalid(validator.validate(schema, [1, 2, 3]), [
      { keyword: "type", instancePath: "/0" },
      { keyword: "type", instancePath: "/1" },
      { keyword: "type", instancePath: "/2" },
    ]);
  });
});

Deno.test("JsonSchemaValidator - object validation", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates minProperties", () => {
    const schema: Schema = { type: "object", minProperties: 2 };

    assertValid(validator.validate(schema, { a: 1, b: 2 }));
    assertValid(validator.validate(schema, { a: 1, b: 2, c: 3 }));
    assertInvalid(validator.validate(schema, { a: 1 }), [{
      keyword: "minProperties",
    }]);
    assertInvalid(validator.validate(schema, {}), [{
      keyword: "minProperties",
    }]);
  });

  await t.step("validates maxProperties", () => {
    const schema: Schema = { type: "object", maxProperties: 2 };

    assertValid(validator.validate(schema, {}));
    assertValid(validator.validate(schema, { a: 1, b: 2 }));
    assertInvalid(validator.validate(schema, { a: 1, b: 2, c: 3 }), [{
      keyword: "maxProperties",
    }]);
  });

  await t.step("validates required properties", () => {
    const schema: Schema = {
      type: "object",
      required: ["name", "age"],
    };

    assertValid(validator.validate(schema, { name: "John", age: 30 }));
    assertValid(
      validator.validate(schema, { name: "Jane", age: 25, city: "NYC" }),
    );
    assertInvalid(validator.validate(schema, { name: "John" }), [{
      keyword: "required",
    }]);
    assertInvalid(validator.validate(schema, { age: 30 }), [{
      keyword: "required",
    }]);
    assertInvalid(validator.validate(schema, {}), [
      { keyword: "required" },
      { keyword: "required" },
    ]);
  });

  await t.step("validates properties schemas", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer", minimum: 0 },
      },
    };

    assertValid(validator.validate(schema, { name: "John", age: 30 }));
    assertValid(validator.validate(schema, {})); // Properties are not required by default
    assertInvalid(validator.validate(schema, { name: 123 }), [{
      keyword: "type",
      instancePath: "/name",
    }]);
    assertInvalid(validator.validate(schema, { age: "thirty" }), [{
      keyword: "type",
      instancePath: "/age",
    }]);
    assertInvalid(validator.validate(schema, { age: -5 }), [{
      keyword: "minimum",
      instancePath: "/age",
    }]);
  });
});

Deno.test("JsonSchemaValidator - const and enum", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates const", () => {
    const schema: Schema = { const: "hello" };

    assertValid(validator.validate(schema, "hello"));
    assertInvalid(validator.validate(schema, "world"), [{ keyword: "const" }]);
    assertInvalid(validator.validate(schema, 123), [{ keyword: "const" }]);
  });

  await t.step("validates const with objects", () => {
    const schema: Schema = { const: { foo: "bar" } };

    assertValid(validator.validate(schema, { foo: "bar" }));
    assertInvalid(validator.validate(schema, { foo: "baz" }), [{
      keyword: "const",
    }]);
    assertInvalid(validator.validate(schema, {}), [{ keyword: "const" }]);
  });

  await t.step("validates enum", () => {
    const schema: Schema = { enum: ["red", "green", "blue"] };

    assertValid(validator.validate(schema, "red"));
    assertValid(validator.validate(schema, "green"));
    assertValid(validator.validate(schema, "blue"));
    assertInvalid(validator.validate(schema, "yellow"), [{ keyword: "enum" }]);
    assertInvalid(validator.validate(schema, 123), [{ keyword: "enum" }]);
  });

  await t.step("validates enum with mixed types", () => {
    const schema: Schema = { enum: [1, "two", null, { three: 3 }] };

    assertValid(validator.validate(schema, 1));
    assertValid(validator.validate(schema, "two"));
    assertValid(validator.validate(schema, null));
    assertValid(validator.validate(schema, { three: 3 }));
    assertInvalid(validator.validate(schema, 2), [{ keyword: "enum" }]);
  });
});

Deno.test("JsonSchemaValidator - composition", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates allOf", () => {
    const schema: Schema = {
      allOf: [
        { type: "object", properties: { name: { type: "string" } } },
        { type: "object", properties: { age: { type: "number" } } },
        { type: "object", required: ["name", "age"] },
      ],
    };

    assertValid(validator.validate(schema, { name: "John", age: 30 }));
    assertInvalid(validator.validate(schema, { name: "John" }), [{
      keyword: "required",
    }]);
    assertInvalid(validator.validate(schema, { name: 123, age: 30 }), [{
      keyword: "type",
      instancePath: "/name",
    }]);
  });

  await t.step("validates anyOf", () => {
    const schema: Schema = {
      anyOf: [
        { type: "string" },
        { type: "number" },
      ],
    };

    assertValid(validator.validate(schema, "hello"));
    assertValid(validator.validate(schema, 123));
    assertInvalid(validator.validate(schema, true), [{ keyword: "anyOf" }]);
    assertInvalid(validator.validate(schema, null), [{ keyword: "anyOf" }]);
  });

  await t.step("validates oneOf", () => {
    const schema: Schema = {
      oneOf: [
        { type: "number", multipleOf: 5 },
        { type: "number", multipleOf: 3 },
      ],
    };

    assertValid(validator.validate(schema, 5)); // Matches first only
    assertValid(validator.validate(schema, 3)); // Matches second only
    assertInvalid(validator.validate(schema, 15), [{ keyword: "oneOf" }]); // Matches both
    assertInvalid(validator.validate(schema, 2), [{ keyword: "oneOf" }]); // Matches neither
  });

  await t.step("validates not", () => {
    const schema: Schema = {
      not: { type: "string" },
    };

    assertValid(validator.validate(schema, 123));
    assertValid(validator.validate(schema, true));
    assertValid(validator.validate(schema, null));
    assertInvalid(validator.validate(schema, "hello"), [{ keyword: "not" }]);
  });
});

Deno.test("JsonSchemaValidator - conditional", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates if-then", () => {
    const schema: Schema = {
      type: "object",
      if: {
        properties: { type: { const: "cat" } },
      },
      then: {
        properties: { meow: { type: "boolean" } },
        required: ["meow"],
      },
    };

    assertValid(validator.validate(schema, { type: "cat", meow: true }));
    assertValid(validator.validate(schema, { type: "dog" })); // if doesn't match, then not applied
    assertInvalid(validator.validate(schema, { type: "cat" }), [{
      keyword: "required",
    }]);
    assertInvalid(validator.validate(schema, { type: "cat", meow: "yes" }), [{
      keyword: "type",
      instancePath: "/meow",
    }]);
  });

  await t.step("validates if-then-else", () => {
    const schema: Schema = {
      type: "object",
      if: {
        properties: { type: { const: "cat" } },
      },
      then: {
        properties: { meow: { type: "boolean" } },
        required: ["meow"],
      },
      else: {
        properties: { bark: { type: "boolean" } },
        required: ["bark"],
      },
    };

    assertValid(validator.validate(schema, { type: "cat", meow: true }));
    assertValid(validator.validate(schema, { type: "dog", bark: true }));
    assertInvalid(validator.validate(schema, { type: "cat" }), [{
      keyword: "required",
    }]);
    assertInvalid(validator.validate(schema, { type: "dog" }), [{
      keyword: "required",
    }]);
  });
});

Deno.test("JsonSchemaValidator - complex schemas", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates OpenAPI-style schema", () => {
    const schema: Schema = {
      type: "object",
      required: ["openapi", "info", "paths"],
      properties: {
        openapi: {
          type: "string",
          pattern: "^3\\.[0-1]\\.[0-9]$",
        },
        info: {
          type: "object",
          required: ["title", "version"],
          properties: {
            title: { type: "string", minLength: 1 },
            version: { type: "string" },
            summary: { type: "string" },
          },
        },
        paths: {
          type: "object",
        },
      },
    };

    assertValid(validator.validate(schema, {
      openapi: "3.1.0",
      info: {
        title: "My API",
        version: "1.0.0",
        summary: "An example API",
      },
      paths: {},
    }));

    assertInvalid(
      validator.validate(schema, {
        openapi: "2.0.0", // Wrong version
        info: { title: "My API", version: "1.0.0" },
        paths: {},
      }),
      [{ keyword: "pattern", instancePath: "/openapi" }],
    );

    assertInvalid(
      validator.validate(schema, {
        openapi: "3.1.0",
        info: { title: "" }, // Missing version, empty title
        paths: {},
      }),
      [
        { keyword: "required", instancePath: "/info" },
        { keyword: "minLength", instancePath: "/info/title" },
      ],
    );
  });

  await t.step("validates deeply nested schema", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        users: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "integer", minimum: 1 },
              name: { type: "string", minLength: 1 },
              email: { type: "string", format: "email" },
              roles: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["admin", "user", "guest"],
                },
                minItems: 1,
                uniqueItems: true,
              },
            },
          },
        },
      },
    };

    assertValid(validator.validate(schema, {
      users: [
        {
          id: 1,
          name: "John Doe",
          email: "john@example.com",
          roles: ["admin", "user"],
        },
        {
          id: 2,
          name: "Jane Smith",
          roles: ["user"],
        },
      ],
    }));

    const result = validator.validate(schema, {
      users: [
        {
          id: 0, // Invalid: less than minimum
          name: "", // Invalid: empty string
          email: "not-an-email", // Invalid format
          roles: [], // Invalid: empty array
        },
        {
          // Missing required fields
          roles: ["admin", "admin"], // Duplicate items
        },
      ],
    });

    assertInvalid(result, [
      { keyword: "minimum", instancePath: "/users/0/id" },
      { keyword: "minLength", instancePath: "/users/0/name" },
      { keyword: "format", instancePath: "/users/0/email" },
      { keyword: "minItems", instancePath: "/users/0/roles" },
      { keyword: "required", instancePath: "/users/1" },
      { keyword: "required", instancePath: "/users/1" },
      { keyword: "uniqueItems", instancePath: "/users/1/roles/1" },
    ]);
  });
});

Deno.test("JsonSchemaValidator - edge cases", async (t) => {
  const validator = new JsonSchemaValidator();

  await t.step("validates empty schema (allows everything)", () => {
    const schema: Schema = {};

    assertValid(validator.validate(schema, null));
    assertValid(validator.validate(schema, 123));
    assertValid(validator.validate(schema, "string"));
    assertValid(validator.validate(schema, []));
    assertValid(validator.validate(schema, {}));
  });

  await t.step("validates with $ref (currently skipped)", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        foo: { $ref: "#/definitions/bar" },
      },
    };

    // Since we don't resolve refs in the validator, this should pass
    assertValid(validator.validate(schema, { foo: "anything" }));
  });

  await t.step("validates integer as number", () => {
    const schema: Schema = { type: "number" };

    // Integers should be valid numbers
    assertValid(validator.validate(schema, 42));
    assertValid(validator.validate(schema, 42.5));
  });

  await t.step("handles invalid regex pattern gracefully", () => {
    const schema: Schema = { type: "string", pattern: "[" }; // Invalid regex

    const result = validator.validate(schema, "test");
    assertInvalid(result, [{ keyword: "pattern" }]);
    assertEquals(result.errors[0]?.message.includes("invalid regex"), true);
  });

  await t.step("validates with custom options", () => {
    const validatorNoFormats = new JsonSchemaValidator({
      validateFormats: false,
    });
    const schema: Schema = { type: "string", format: "email" };

    assertValid(validatorNoFormats.validate(schema, "not-an-email"));

    const validatorUnknownFormats = new JsonSchemaValidator({
      allowUnknownFormats: false,
    });
    const unknownFormatSchema: Schema = {
      type: "string",
      format: "custom-format",
    };

    assertInvalid(
      validatorUnknownFormats.validate(unknownFormatSchema, "test"),
      [{ keyword: "format" }],
    );
  });
});

Deno.test("JsonSchemaValidator - OpenAPI 3.1 specific", async (t) => {
  const validator = new JsonSchemaValidator({
    dialect: "https://spec.openapis.org/oas/3.1/dialect/base",
  });

  await t.step("handles nullable (deprecated but still used)", () => {
    // In OpenAPI 3.1, nullable is deprecated in favor of type arrays
    const schema: Schema = {
      type: ["string", "null"],
    };

    assertValid(validator.validate(schema, "hello"));
    assertValid(validator.validate(schema, null));
    assertInvalid(validator.validate(schema, 123), [{ keyword: "type" }]);
  });

  await t.step("validates discriminator usage", () => {
    const schema: Schema = {
      oneOf: [
        {
          type: "object",
          required: ["type", "meow"],
          properties: {
            type: { const: "cat" },
            meow: { type: "boolean" },
          },
        },
        {
          type: "object",
          required: ["type", "bark"],
          properties: {
            type: { const: "dog" },
            bark: { type: "boolean" },
          },
        },
      ],
      discriminator: {
        propertyName: "type",
      },
    };

    // Note: discriminator is metadata, doesn't affect validation
    assertValid(validator.validate(schema, { type: "cat", meow: true }));
    assertValid(validator.validate(schema, { type: "dog", bark: true }));
    assertInvalid(validator.validate(schema, { type: "bird" }), [{
      keyword: "oneOf",
    }]);
  });
});
