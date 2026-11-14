import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MAX_DOCUMENT_DEPTH, parseSpec, parseSpecFromFile } from "./parser.ts";
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
    assertEquals(result.spec.openapi, "3.1.0");
    assertEquals(result.spec.info.title, "Test API");
    assertEquals(result.defaultedFields.length, 0);
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
    assertEquals(result.spec.openapi, "3.1.0");
    assertEquals(result.spec.info.title, "Test API");
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
    assertEquals(result.spec.openapi, "3.1.0");
  });

  await t.step("auto-detects YAML from content", async () => {
    const yaml = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}`;
    const result = await parseSpec(yaml);
    assertEquals(result.spec.openapi, "3.1.0");
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
    assertEquals(result.spec.openapi, "3.0.0");
  });

  await t.step("accepts OpenAPI 3.1.x", async () => {
    const result = await parseSpec(json(validSpec({ openapi: "3.1.0" })));
    assertEquals(result.spec.openapi, "3.1.0");
  });

  await t.step("defaults openapi when missing", async () => {
    const spec = { info: { title: "Test", version: "1.0.0" }, paths: {} };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.openapi, "3.1.0");
    assertEquals(result.defaultedFields.includes("openapi"), true);
  });

  await t.step("defaults openapi when not a string", async () => {
    const spec = {
      openapi: 3.1,
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.openapi, "3.1.0");
    assertEquals(result.defaultedFields.includes("openapi"), true);
  });

  await t.step("throws when version is not 3.x", async () => {
    await assertRejects(
      async () => await parseSpec(json(validSpec({ openapi: "2.0.0" }))),
      SpecValidationError,
      "Unsupported OpenAPI version",
    );
  });
});

Deno.test("parseSpec - info validation (lenient)", async (t) => {
  await t.step("defaults info when missing", async () => {
    const spec = { openapi: "3.1.0", paths: {} };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.info.title, "Untitled API");
    assertEquals(result.spec.info.version, "unknown");
    assertEquals(result.defaultedFields.includes("info"), true);
  });

  await t.step("defaults info when not an object", async () => {
    const spec = { openapi: "3.1.0", info: "not an object", paths: {} };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.info.title, "Untitled API");
    assertEquals(result.defaultedFields.includes("info"), true);
  });

  await t.step("defaults title when missing", async () => {
    const spec = { openapi: "3.1.0", info: { version: "1.0.0" }, paths: {} };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.info.title, "Untitled API");
    assertEquals(result.defaultedFields.includes("info.title"), true);
  });

  await t.step("defaults version when missing", async () => {
    const spec = { openapi: "3.1.0", info: { title: "Test API" }, paths: {} };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.info.version, "unknown");
    assertEquals(result.defaultedFields.includes("info.version"), true);
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
    assertEquals(result.spec.info.summary, "A brief description");
  });
});

Deno.test("parseSpec - paths validation (lenient)", async (t) => {
  await t.step("defaults paths when missing in OpenAPI 3.0", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
    };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.paths, {});
    assertEquals(result.defaultedFields.includes("paths"), true);
  });

  await t.step(
    "defaults paths when missing in OpenAPI 3.1 without webhooks",
    async () => {
      const spec = {
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
      };
      const result = await parseSpec(json(spec));
      assertEquals(result.spec.paths, {});
      assertEquals(result.defaultedFields.includes("paths"), true);
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
    assertEquals(
      result.spec.webhooks?.newOrder?.post?.summary,
      "New order webhook",
    );
    assertEquals(result.defaultedFields.includes("paths"), true);
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
    assertEquals(result.spec.components?.schemas?.User?.type, "object");
    assertEquals(result.defaultedFields.includes("paths"), true);
  });

  await t.step("defaults paths when not an object", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: [],
    };
    const result = await parseSpec(json(spec));
    assertEquals(result.spec.paths, {});
    assertEquals(result.defaultedFields.includes("paths"), true);
  });

  await t.step("accepts empty paths object", async () => {
    const result = await parseSpec(json(validSpec()));
    assertEquals(result.spec.paths, {});
    assertEquals(result.defaultedFields.length, 0);
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
      result.spec.jsonSchemaDialect,
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
    assertEquals(typeof result.spec.webhooks, "object");
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
    assertEquals(typeof result.spec.components?.pathItems, "object");
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
    assertEquals(result.spec.openapi, "3.1.0");
  });

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
      assertEquals(result.spec.openapi, "3.1.0");
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
    assertEquals(result.spec.openapi, "3.1.0");
  });
});

Deno.test("parseSpec - multiple errors", async (t) => {
  await t.step("collects structural errors (3.1 fields)", async () => {
    // With lenient parser, metadata fields get defaults instead of errors.
    // Structural errors (invalid types for jsonSchemaDialect, webhooks, etc.) still throw.
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
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
        assertEquals(allErrors.length >= 2, true);
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
    assertEquals(result.spec.openapi, "3.1.0");
    assertEquals(result.spec.info.title, "Pet Store API");
    assertEquals(
      result.spec.jsonSchemaDialect,
      "https://spec.openapis.org/oas/3.1/dialect/base",
    );
    assertEquals(typeof result.spec.webhooks, "object");
    assertEquals(result.defaultedFields.length, 0);
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
    assertEquals(result.spec.openapi, "3.1.0");
  });

  await t.step("loads and parses YAML file", async () => {
    const yaml = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}`;
    const path = await createTestFile("test.yaml", yaml);
    const result = await parseSpecFromFile(path);
    assertEquals(result.spec.openapi, "3.1.0");
  });

  await t.step("adds file context to errors", async () => {
    const path = await createTestFile("bad-version.json", {
      openapi: "2.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    });

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

// =============================================================================
// Documents that are not trees (YAML aliases) or are nested too deeply
// =============================================================================

const YAML_HEAD = `openapi: 3.1.0\ninfo: {title: t, version: "1"}\npaths: {}\n`;

async function parseError(content: string, format: "yaml" | "json") {
  return await assertRejects(
    async () => await parseSpec(content, { format }),
    ParseError,
  );
}

Deno.test("parseSpec - document shape", async (t) => {
  await t.step(
    "a YAML alias to an ancestor is rejected with both locations",
    async () => {
      const error = await parseError(
        YAML_HEAD + "x-loop: &l\n  inner:\n    self: *l\n",
        "yaml",
      );
      assertEquals(error.message, "Document contains itself");
      assertStringIncludes(error.context.reason, "#/x-loop/inner/self");
      assertStringIncludes(error.context.reason, "alias to #/x-loop,");
      assertStringIncludes(error.context.suggestion ?? "", "$ref");
    },
  );

  await t.step(
    "nested YAML aliases that expand exponentially are rejected quickly",
    async () => {
      let text = YAML_HEAD + "x-a0: &a0 {type: string}\n";
      for (let i = 1; i <= 40; i++) {
        text += `x-a${i}: &a${i} {p: *a${i - 1}, q: *a${i - 1}}\n`;
      }
      const start = performance.now();
      const error = await parseError(text, "yaml");
      assertEquals(performance.now() - start < 1000, true);
      assertEquals(error.message, "YAML aliases expand to too many values");
      assertStringIncludes(error.context.reason, "written out as JSON it has");
    },
  );

  await t.step(
    "an anchor reused many times in a small document is accepted",
    async () => {
      // 2 000 uses of one anchor: 2 000 times the distinct size, far below the
      // absolute limit.
      let text = YAML_HEAD +
        "x-common: &common {type: object, properties: {id: {type: string}}}\n";
      text += "components:\n  schemas:\n";
      for (let i = 0; i < 2000; i++) text += `    S${i}: *common\n`;
      const result = await parseSpec(text, { format: "yaml" });
      assertEquals(
        Object.keys(result.spec.components?.schemas ?? {}).length,
        2000,
      );
    },
  );

  await t.step(
    "nesting beyond the limit is rejected, not a stack overflow",
    async () => {
      // Built as text: JSON.stringify itself overflows the stack at this
      // depth.
      const levels = 20_000;
      const text = '{"openapi":"3.1.0","info":{"title":"t","version":"1"},' +
        '"paths":{},"components":{"schemas":{"Deep":' +
        '{"type":"object","properties":{"a":'.repeat(levels) +
        '{"type":"string"}' + "}}".repeat(levels) + "}}}";
      const error = await parseError(text, "json");
      assertEquals(error.message, "Document is nested too deeply");
      assertStringIncludes(error.context.reason, "40003 levels");
      assertStringIncludes(
        error.context.reason,
        "#/components/schemas/Deep/properties/a/",
      );
      assertStringIncludes(error.context.reason, `up to ${MAX_DOCUMENT_DEPTH}`);
    },
  );

  await t.step("nesting at the limit is accepted", async () => {
    // components/schemas/Deep is at depth 3; each level adds 2.
    let schema: unknown = {};
    for (let i = 0; i < (MAX_DOCUMENT_DEPTH - 3) / 2 - 1; i++) {
      schema = { type: "object", properties: { a: schema } };
    }
    const result = await parseSpec(
      json({ ...validSpec(), components: { schemas: { Deep: schema } } }),
      { format: "json" },
    );
    assertEquals(typeof result.spec.components?.schemas?.Deep, "object");
  });
});
