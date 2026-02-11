import { assertEquals, assertRejects } from "@std/assert";
import { parseSpec, parseSpecFromFile } from "./parser.ts";
import { ParseError, SpecValidationError } from "./errors.ts";

// Helper to convert object to JSON string
const json = (obj: object) => JSON.stringify(obj, null, 2);

// Helper to create valid base spec
const validSpec = (overrides: object = {}) => ({
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {},
  ...overrides,
});

// =============================================================================
// parseSpec - Content-based parsing (no filesystem)
// =============================================================================

Deno.test("parseSpec - JSON parsing", async (t) => {
  await t.step("parses valid JSON", async () => {
    const result = await parseSpec(json(validSpec()), { format: "json" });
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Test API");
  });

  await t.step("throws on invalid JSON", async () => {
    await assertRejects(
      async () =>
        await parseSpec('{ "openapi": "3.1.0", invalid }', { format: "json" }),
      ParseError,
      "Invalid JSON syntax",
    );
  });

  await t.step("throws on JSON with trailing comma", async () => {
    await assertRejects(
      async () =>
        await parseSpec('{ "openapi": "3.1.0", }', { format: "json" }),
      ParseError,
      "Invalid JSON syntax",
    );
  });
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
    const result = await parseSpec(yaml, { format: "yaml" });
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Test API");
  });

  await t.step("throws on invalid YAML", async () => {
    const yaml = `
openapi: 3.1.0
info:
  title: Test API
  invalid yaml here
    bad: indentation
`;
    await assertRejects(
      async () => await parseSpec(yaml, { format: "yaml" }),
      ParseError,
      "Invalid YAML syntax",
    );
  });
});

Deno.test("parseSpec - format auto-detection", async (t) => {
  await t.step("auto-detects JSON from content", async () => {
    const result = await parseSpec(json(validSpec()));
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("auto-detects YAML from content", async () => {
    const yaml = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}`;
    const result = await parseSpec(yaml);
    assertEquals(result.openapi, "3.1.0");
  });
});

Deno.test("parseSpec - structure validation", async (t) => {
  await t.step("throws when spec is not an object", async () => {
    await assertRejects(
      async () => await parseSpec("[]"),
      SpecValidationError,
      "Invalid OpenAPI spec structure",
    );
  });

  await t.step("throws when spec is null", async () => {
    await assertRejects(
      async () => await parseSpec("null"),
      SpecValidationError,
      "Invalid OpenAPI spec structure",
    );
  });

  await t.step("throws when spec is a string", async () => {
    await assertRejects(
      async () => await parseSpec('"not an object"'),
      SpecValidationError,
      "Invalid OpenAPI spec structure",
    );
  });
});

Deno.test("parseSpec - OpenAPI version validation", async (t) => {
  await t.step("accepts OpenAPI 3.0.x", async () => {
    const result = await parseSpec(json(validSpec({ openapi: "3.0.0" })));
    assertEquals(result.openapi, "3.0.0");
  });

  await t.step("accepts OpenAPI 3.1.x", async () => {
    const result = await parseSpec(json(validSpec({ openapi: "3.1.0" })));
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("throws when openapi field is missing", async () => {
    const spec = { info: { title: "Test", version: "1.0.0" }, paths: {} };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing or invalid OpenAPI version",
    );
  });

  await t.step("throws when openapi is not a string", async () => {
    const spec = {
      openapi: 3.1,
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing or invalid OpenAPI version",
    );
  });

  await t.step("throws when version is not 3.x", async () => {
    await assertRejects(
      async () => await parseSpec(json(validSpec({ openapi: "2.0.0" }))),
      SpecValidationError,
      "Unsupported OpenAPI version",
    );
  });
});

Deno.test("parseSpec - info validation", async (t) => {
  await t.step("throws when info is missing", async () => {
    const spec = { openapi: "3.1.0", paths: {} };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing or invalid info object",
    );
  });

  await t.step("throws when info is not an object", async () => {
    const spec = { openapi: "3.1.0", info: "not an object", paths: {} };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing or invalid info object",
    );
  });

  await t.step("throws when title is missing", async () => {
    const spec = { openapi: "3.1.0", info: { version: "1.0.0" }, paths: {} };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing API title",
    );
  });

  await t.step("throws when version is missing", async () => {
    const spec = { openapi: "3.1.0", info: { title: "Test API" }, paths: {} };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing API version",
    );
  });

  await t.step("validates info.summary in OpenAPI 3.1", async () => {
    const spec = validSpec({
      info: { title: "Test", version: "1.0.0", summary: 123 },
    });
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Invalid info summary",
    );
  });

  await t.step("accepts valid info.summary", async () => {
    const spec = validSpec({
      info: { title: "Test", version: "1.0.0", summary: "A brief description" },
    });
    const result = await parseSpec(json(spec));
    assertEquals(result.info.summary, "A brief description");
  });
});

Deno.test("parseSpec - paths validation", async (t) => {
  await t.step("throws when paths is missing in OpenAPI 3.0", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
    };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing paths object",
    );
  });

  await t.step(
    "throws when paths is missing in OpenAPI 3.1 without webhooks",
    async () => {
      const spec = {
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
      };
      await assertRejects(
        async () => await parseSpec(json(spec)),
        SpecValidationError,
        "Missing paths, webhooks, or components",
      );
    },
  );

  await t.step("accepts OpenAPI 3.1 with webhooks but no paths", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      webhooks: {
        newOrder: {
          post: { summary: "New order webhook" },
        },
      },
    };
    const result = await parseSpec(json(spec));
    assertEquals(result.webhooks?.newOrder?.post?.summary, "New order webhook");
  });

  await t.step("accepts OpenAPI 3.1 with components but no paths", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      components: {
        schemas: { User: { type: "object" } },
      },
    };
    const result = await parseSpec(json(spec));
    assertEquals(result.components?.schemas?.User?.type, "object");
  });

  await t.step("throws when paths is not an object", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: [],
    };
    await assertRejects(
      async () => await parseSpec(json(spec)),
      SpecValidationError,
      "Missing paths object",
    );
  });

  await t.step("accepts empty paths object", async () => {
    const result = await parseSpec(json(validSpec()));
    assertEquals(result.paths, {});
  });
});

Deno.test("parseSpec - OpenAPI 3.1 specific fields", async (t) => {
  await t.step("validates jsonSchemaDialect type", async () => {
    await assertRejects(
      async () => await parseSpec(json(validSpec({ jsonSchemaDialect: 123 }))),
      SpecValidationError,
      "Invalid jsonSchemaDialect",
    );
  });

  await t.step("validates jsonSchemaDialect URI", async () => {
    await assertRejects(
      async () =>
        await parseSpec(json(validSpec({ jsonSchemaDialect: "not a uri" }))),
      SpecValidationError,
      "Invalid jsonSchemaDialect URI",
    );
  });

  await t.step("accepts valid jsonSchemaDialect", async () => {
    const spec = validSpec({
      jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    });
    const result = await parseSpec(json(spec));
    assertEquals(
      result.jsonSchemaDialect,
      "https://spec.openapis.org/oas/3.1/dialect/base",
    );
  });

  await t.step("validates webhooks type", async () => {
    await assertRejects(
      async () =>
        await parseSpec(json(validSpec({ webhooks: "not an object" }))),
      SpecValidationError,
      "Invalid webhooks object",
    );
  });

  await t.step("accepts valid webhooks", async () => {
    const spec = validSpec({
      webhooks: {
        userRegistered: {
          post: {
            requestBody: {
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    });
    const result = await parseSpec(json(spec));
    assertEquals(typeof result.webhooks, "object");
  });

  await t.step("validates components.pathItems type", async () => {
    await assertRejects(
      async () =>
        await parseSpec(
          json(validSpec({ components: { pathItems: "not an object" } })),
        ),
      SpecValidationError,
      "Invalid components.pathItems",
    );
  });

  await t.step("accepts valid components.pathItems", async () => {
    const spec = validSpec({
      components: {
        pathItems: {
          userOperations: {
            get: { responses: { "200": { description: "Success" } } },
          },
        },
      },
    });
    const result = await parseSpec(json(spec));
    assertEquals(typeof result.components?.pathItems, "object");
  });
});

Deno.test("parseSpec - reference validation", async (t) => {
  await t.step("validates valid references", async () => {
    const spec = validSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "Success",
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
            properties: { id: { type: "integer" }, name: { type: "string" } },
          },
        },
      },
    });
    const result = await parseSpec(json(spec));
    assertEquals(result.openapi, "3.1.0");
  });

  // TODO: Implement internal $ref resolution validation during parsing
  await t.step(
    "accepts specs with unresolved references (validation is deferred)",
    async () => {
      const spec = validSpec({
        paths: {
          "/users": {
            get: {
              responses: {
                "200": {
                  description: "Success",
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
      });
      const result = await parseSpec(json(spec));
      assertEquals(result.openapi, "3.1.0");
    },
  );

  await t.step("validates nested references", async () => {
    const spec = validSpec({
      components: {
        schemas: {
          Pet: { type: "object", discriminator: { propertyName: "type" } },
          Cat: {
            allOf: [{ $ref: "#/components/schemas/Pet" }, {
              type: "object",
              properties: { meow: { type: "boolean" } },
            }],
          },
        },
      },
    });
    const result = await parseSpec(json(spec));
    assertEquals(result.openapi, "3.1.0");
  });
});

Deno.test("parseSpec - multiple errors", async (t) => {
  await t.step("collects all validation errors", async () => {
    const spec = {
      // Missing openapi version
      info: { summary: 123 }, // Missing title, version; wrong type summary
      // Missing paths
      jsonSchemaDialect: "not a uri",
      webhooks: "not an object",
    };

    try {
      await parseSpec(json(spec));
      throw new Error("Should have thrown");
    } catch (error) {
      if (error instanceof SpecValidationError) {
        assertEquals(error.message.includes("Found"), true);
        assertEquals(error.message.includes("validation errors"), true);
        const allErrors = error.context.allErrors as SpecValidationError[];
        assertEquals(Array.isArray(allErrors), true);
        assertEquals(allErrors.length > 5, true);
      } else {
        throw error;
      }
    }
  });
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
        contact: { name: "API Support", email: "support@example.com" },
        license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
      },
      servers: [{
        url: "https://api.example.com/v1",
        description: "Production server",
      }],
      paths: {
        "/pets": {
          get: {
            summary: "List all pets",
            operationId: "listPets",
            tags: ["pets"],
            parameters: [{
              name: "limit",
              in: "query",
              schema: { type: "integer" },
            }],
            responses: {
              "200": {
                description: "A paged array of pets",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Pets" },
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
            properties: { id: { type: "integer" }, name: { type: "string" } },
          },
          Pets: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
        },
      },
      webhooks: {
        petUpdate: {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
            responses: { "200": { description: "Webhook processed" } },
          },
        },
      },
      jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    };

    const result = await parseSpec(json(spec));
    assertEquals(result.openapi, "3.1.0");
    assertEquals(result.info.title, "Pet Store API");
    assertEquals(
      result.jsonSchemaDialect,
      "https://spec.openapis.org/oas/3.1/dialect/base",
    );
    assertEquals(typeof result.webhooks, "object");
  });
});

// =============================================================================
// parseSpecFromFile - File loading (integration tests)
// =============================================================================

const TEST_DIR = "/tmp/openapi-parser-tests";

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

async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch { /* ignore */ }
}

Deno.test("parseSpecFromFile - file loading", async (t) => {
  await t.step("throws when file doesn't exist", async () => {
    await assertRejects(
      async () => await parseSpecFromFile("/non/existent/file.yaml"),
      ParseError,
      "OpenAPI spec file not found",
    );
  });

  await t.step("loads and parses JSON file", async () => {
    const path = await createTestFile("test.json", validSpec());
    const result = await parseSpecFromFile(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("loads and parses YAML file", async () => {
    const yaml = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}`;
    const path = await createTestFile("test.yaml", yaml);
    const result = await parseSpecFromFile(path);
    assertEquals(result.openapi, "3.1.0");
  });

  await t.step("adds file context to errors", async () => {
    const spec = { openapi: "3.1.0", paths: {} }; // Missing info
    const path = await createTestFile("missing-info.json", spec);

    try {
      await parseSpecFromFile(path);
      throw new Error("Should have thrown");
    } catch (error) {
      if (error instanceof SpecValidationError) {
        assertEquals(error.context.specFile, path);
      } else {
        throw error;
      }
    }
  });

  await cleanup();
});
