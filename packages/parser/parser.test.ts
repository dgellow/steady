import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseSpec } from "./parser.ts";
import { ParseError, ValidationError } from "./errors.ts";

const TEST_DIR = "/tmp/openapi-parser-tests";

// Helper to create test files
async function createTestFile(
  filename: string,
  content: string | object,
): Promise<string> {
  await Deno.mkdir(TEST_DIR, { recursive: true });
  const path = `${TEST_DIR}/${filename}`;
  const data = typeof content === "string"
    ? content
    : JSON.stringify(content, null, 2);
  await Deno.writeTextFile(path, data);
  return path;
}

// Cleanup after tests
async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
}

Deno.test("parseSpec - file handling", async (t) => {
  await t.step("throws when file doesn't exist", async () => {
    await assertRejects(
      async () => await parseSpec("/non/existent/file.yaml"),
      ParseError,
      "OpenAPI spec file not found",
    );
  });

  await t.step("throws when file is not readable", async () => {
    const path = await createTestFile("unreadable.yaml", "test");
    await Deno.chmod(path, 0o000);

    await assertRejects(
      async () => await parseSpec(path),
      ParseError,
      "Failed to read OpenAPI spec file",
    );

    await Deno.chmod(path, 0o644); // Restore permissions for cleanup
  });

  await cleanup();
});

Deno.test("parseSpec - JSON parsing", async (t) => {
  await t.step("parses valid JSON", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("valid.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Test API");
  });

  await t.step("throws on invalid JSON", async () => {
    const path = await createTestFile(
      "invalid.json",
      '{ "openapi": "3.1.0", invalid json }',
    );

    await assertRejects(
      async () => await parseSpec(path),
      ParseError,
      "Invalid JSON syntax",
    );
  });

  await t.step("throws on JSON with trailing comma", async () => {
    const path = await createTestFile(
      "trailing-comma.json",
      '{ "openapi": "3.1.0", }',
    );

    await assertRejects(
      async () => await parseSpec(path),
      ParseError,
      "Invalid JSON syntax",
    );
  });

  await cleanup();
});

Deno.test("parseSpec - YAML parsing", async (t) => {
  await t.step("parses valid YAML", async () => {
    const yaml = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}
`;
    const path = await createTestFile("valid.yaml", yaml);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Test API");
  });

  await t.step("throws on invalid YAML", async () => {
    const yaml = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
  invalid yaml here
    bad: indentation
`;
    const path = await createTestFile("invalid.yaml", yaml);

    await assertRejects(
      async () => await parseSpec(path),
      ParseError,
      "Invalid YAML syntax",
    );
  });

  await t.step("handles YAML with .yml extension", async () => {
    const yaml = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}
`;
    const path = await createTestFile("valid.yml", yaml);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await cleanup();
});

Deno.test("parseSpec - auto-detection", async (t) => {
  await t.step("detects JSON from content", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("noext", JSON.stringify(spec));

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("detects YAML from content", async () => {
    const yaml = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}`;
    const path = await createTestFile("noext2", yaml);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await cleanup();
});

Deno.test("parseSpec - structure validation", async (t) => {
  await t.step("throws when spec is not an object", async () => {
    const path = await createTestFile("array.json", []);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid OpenAPI spec structure",
    );
  });

  await t.step("throws when spec is null", async () => {
    const path = await createTestFile("null.json", "null");

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid OpenAPI spec structure",
    );
  });

  await t.step("throws when spec is a string", async () => {
    const path = await createTestFile("string.json", '"not an object"');

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid OpenAPI spec structure",
    );
  });

  await cleanup();
});

Deno.test("parseSpec - OpenAPI version validation", async (t) => {
  await t.step("accepts OpenAPI 3.0.x", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("v3.0.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.0.0");
  });

  await t.step("accepts OpenAPI 3.1.x", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("v3.1.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("throws when openapi field is missing", async () => {
    const spec = {
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("no-version.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing or invalid OpenAPI version",
    );
  });

  await t.step("throws when openapi is not a string", async () => {
    const spec = {
      openapi: 3.1,
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("number-version.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing or invalid OpenAPI version",
    );
  });

  await t.step("throws when version is not 3.x", async () => {
    const spec = {
      openapi: "2.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("v2.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Unsupported OpenAPI version",
    );
  });

  await cleanup();
});

Deno.test("parseSpec - info validation", async (t) => {
  await t.step("throws when info is missing", async () => {
    const spec = {
      openapi: "3.1.0",
      paths: {},
    };
    const path = await createTestFile("no-info.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing or invalid info object",
    );
  });

  await t.step("throws when info is not an object", async () => {
    const spec = {
      openapi: "3.1.0",
      info: "not an object",
      paths: {},
    };
    const path = await createTestFile("bad-info.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing or invalid info object",
    );
  });

  await t.step("throws when title is missing", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("no-title.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing API title",
    );
  });

  await t.step("throws when version is missing", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test API" },
      paths: {},
    };
    const path = await createTestFile("no-version.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing API version",
    );
  });

  await t.step("validates info.summary in OpenAPI 3.1", async () => {
    const spec = {
      openapi: "3.1.0",
      info: {
        title: "Test API",
        version: "1.0.0",
        summary: 123, // Should be string
      },
      paths: {},
    };
    const path = await createTestFile("bad-summary.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid info summary",
    );
  });

  await t.step("accepts valid info.summary", async () => {
    const spec = {
      openapi: "3.1.0",
      info: {
        title: "Test API",
        version: "1.0.0",
        summary: "A brief description",
      },
      paths: {},
    };
    const path = await createTestFile("good-summary.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.info.summary, "A brief description");
  });

  await cleanup();
});

Deno.test("parseSpec - paths validation", async (t) => {
  await t.step("throws when paths is missing", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
    };
    const path = await createTestFile("no-paths.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing paths object",
    );
  });

  await t.step("throws when paths is not an object", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: [],
    };
    const path = await createTestFile("bad-paths.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Missing paths object",
    );
  });

  await t.step("accepts empty paths object", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const path = await createTestFile("empty-paths.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.paths, {});
  });

  await cleanup();
});

Deno.test("parseSpec - OpenAPI 3.1 specific fields", async (t) => {
  await t.step("validates jsonSchemaDialect", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      jsonSchemaDialect: 123, // Should be string
    };
    const path = await createTestFile("bad-dialect.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid jsonSchemaDialect",
    );
  });

  await t.step("validates jsonSchemaDialect URI", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      jsonSchemaDialect: "not a uri",
    };
    const path = await createTestFile("bad-dialect-uri.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid jsonSchemaDialect URI",
    );
  });

  await t.step("accepts valid jsonSchemaDialect", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    };
    const path = await createTestFile("good-dialect.json", spec);

    const result = await parseSpec(path);
    assertEquals(
      result.jsonSchemaDialect,
      "https://spec.openapis.org/oas/3.1/dialect/base",
    );
  });

  await t.step("validates webhooks", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      webhooks: "not an object",
    };
    const path = await createTestFile("bad-webhooks.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid webhooks object",
    );
  });

  await t.step("accepts valid webhooks", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      webhooks: {
        userRegistered: {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    };
    const path = await createTestFile("good-webhooks.json", spec);

    const result = await parseSpec(path);
    assertEquals(typeof result.webhooks, "object");
  });

  await t.step("validates components.pathItems", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      components: {
        pathItems: "not an object",
      },
    };
    const path = await createTestFile("bad-pathitems.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid components.pathItems",
    );
  });

  await t.step("accepts valid components.pathItems", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      components: {
        pathItems: {
          userOperations: {
            get: {
              responses: {
                "200": { description: "Success" },
              },
            },
          },
        },
      },
    };
    const path = await createTestFile("good-pathitems.json", spec);

    const result = await parseSpec(path);
    assertEquals(typeof result.components?.pathItems, "object");
  });

  await cleanup();
});

Deno.test("parseSpec - reference validation", async (t) => {
  await t.step("validates valid references", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
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
          User: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
          },
        },
      },
    };
    const path = await createTestFile("valid-refs.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("throws on invalid references", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NonExistent" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const path = await createTestFile("invalid-refs.json", spec);

    await assertRejects(
      async () => await parseSpec(path),
      ValidationError,
      "Invalid reference",
    );
  });

  await t.step("validates nested references", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          Pet: {
            type: "object",
            discriminator: { propertyName: "type" },
          },
          Cat: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              {
                type: "object",
                properties: {
                  meow: { type: "boolean" },
                },
              },
            ],
          },
        },
      },
    };
    const path = await createTestFile("nested-refs.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await cleanup();
});

Deno.test("parseSpec - multiple errors", async (t) => {
  await t.step("collects all validation errors", async () => {
    const spec = {
      // Missing openapi version
      info: {
        // Missing title
        // Missing version
        summary: 123, // Wrong type
      },
      // Missing paths
      jsonSchemaDialect: "not a uri",
      webhooks: "not an object",
    };
    const path = await createTestFile("multiple-errors.json", spec);

    try {
      await parseSpec(path);
      throw new Error("Should have thrown");
    } catch (error) {
      if (error instanceof ValidationError) {
        // Should mention multiple errors
        assertEquals(error.message.includes("Found"), true);
        assertEquals(error.message.includes("validation errors"), true);

        // Should have all errors in context
        const allErrors = error.context.allErrors as ValidationError[];
        assertEquals(Array.isArray(allErrors), true);
        assertEquals(allErrors.length > 5, true); // At least 6 errors
      } else {
        throw error;
      }
    }
  });

  await cleanup();
});

Deno.test("parseSpec - complex valid spec", async (t) => {
  await t.step("parses complete OpenAPI 3.1 spec", async () => {
    const spec = {
      openapi: "3.1.0",
      info: {
        title: "Pet Store API",
        version: "1.0.0",
        summary: "A sample Pet Store Server",
        description: "This is a sample server for a pet store.",
        contact: {
          name: "API Support",
          email: "support@example.com",
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT",
        },
      },
      servers: [
        {
          url: "https://api.example.com/v1",
          description: "Production server",
        },
      ],
      paths: {
        "/pets": {
          get: {
            summary: "List all pets",
            operationId: "listPets",
            tags: ["pets"],
            parameters: [
              {
                name: "limit",
                in: "query",
                description: "How many items to return",
                required: false,
                schema: {
                  type: "integer",
                  format: "int32",
                },
              },
            ],
            responses: {
              "200": {
                description: "A paged array of pets",
                headers: {
                  "x-next": {
                    description: "A link to the next page of responses",
                    schema: {
                      type: "string",
                    },
                  },
                },
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Pets",
                    },
                  },
                },
              },
              default: {
                description: "unexpected error",
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Error",
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
          Pet: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: {
                type: "integer",
                format: "int64",
              },
              name: {
                type: "string",
              },
              tag: {
                type: "string",
              },
            },
          },
          Pets: {
            type: "array",
            maxItems: 100,
            items: {
              $ref: "#/components/schemas/Pet",
            },
          },
          Error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "integer",
                format: "int32",
              },
              message: {
                type: "string",
              },
            },
          },
        },
      },
      webhooks: {
        petUpdate: {
          post: {
            requestBody: {
              description: "Information about a pet update",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Pet",
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Webhook processed successfully",
              },
            },
          },
        },
      },
      jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    };
    const path = await createTestFile("complete.json", spec);

    const result = await parseSpec(path);
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Pet Store API");
    assertEquals(
      result.jsonSchemaDialect,
      "https://spec.openapis.org/oas/3.1/dialect/base",
    );
    assertEquals(typeof result.webhooks, "object");
  });

  await cleanup();
});
