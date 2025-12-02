import { parse as parseYAML } from "@std/yaml";
import { OpenAPISpec } from "./openapi.ts";
import { ParseError, ValidationError, ErrorContext } from "./errors.ts";
import { JsonSchemaProcessor, type Schema } from "../json-schema/mod.ts";
import metaschemaJson from "./schemas/openapi-3.1.json" with { type: "json" };

const metaschema = metaschemaJson as unknown as Schema;

export async function parseSpec(path: string): Promise<OpenAPISpec> {
  // Check if file exists
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ParseError("OpenAPI spec file not found", {
        specFile: path,
        errorType: "parse",
        reason: `The file "${path}" does not exist`,
        suggestion: "Check that the file path is correct and the file exists",
        examples: [
          "steady api.yaml",
          "steady ./specs/openapi.json",
          "steady ../api/spec.yml",
        ],
      });
    }
    throw error;
  }

  // Read file content
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch (error) {
    throw new ParseError("Failed to read OpenAPI spec file", {
      specFile: path,
      errorType: "parse",
      reason: `Could not read file: ${
        error instanceof Error ? error.message : String(error)
      }`,
      suggestion: "Check that you have permission to read the file",
    });
  }

  // Parse based on file extension
  let spec: unknown;
  const ext = path.toLowerCase();

  try {
    if (ext.endsWith(".json")) {
      spec = JSON.parse(content);
    } else if (ext.endsWith(".yaml") || ext.endsWith(".yml")) {
      spec = parseYAML(content);
    } else {
      // Try to parse as YAML first, then JSON
      try {
        spec = parseYAML(content);
      } catch {
        spec = JSON.parse(content);
      }
    }
  } catch (error) {
    const isJSON = ext.endsWith(".json") || content.trimStart().startsWith("{");
    throw new ParseError(`Invalid ${isJSON ? "JSON" : "YAML"} syntax`, {
      specFile: path,
      errorType: "parse",
      reason: `Failed to parse file: ${
        error instanceof Error ? error.message : String(error)
      }`,
      suggestion: `Check that your file contains valid ${
        isJSON ? "JSON" : "YAML"
      }`,
      examples: isJSON
        ? [
          "{",
          '  "openapi": "3.0.0",',
          '  "info": {',
          '    "title": "My API",',
          '    "version": "1.0.0"',
          "  },",
          '  "paths": {}',
          "}",
        ]
        : [
          "openapi: 3.1.0",
          "info:",
          "  title: My API",
          "  version: 1.0.0",
          "paths: {}",
        ],
    });
  }

  // Basic structural validation - must be an object to continue
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new ValidationError("Invalid OpenAPI spec structure", {
      specFile: path,
      errorType: "validate",
      reason: "OpenAPI spec must be an object, not an array or primitive value",
      suggestion: "Ensure your spec file contains a valid OpenAPI object",
      examples: [
        "openapi: 3.1.0",
        "info:",
        "  title: My API",
        "  version: 1.0.0",
        "paths: {}",
      ],
    });
  }

  const s = spec as Record<string, unknown>;
  const errors: ValidationError[] = [];

  // Helper to create and collect validation errors
  function addError(message: string, context: Omit<ErrorContext, "errorType">) {
    errors.push(new ValidationError(message, { ...context, errorType: "validate" }));
  }

  // Validate openapi version field
  let version: string | null = null;
  if (typeof s.openapi !== "string") {
    addError("Missing or invalid OpenAPI version", {
      specFile: path,
      reason:
        "Every OpenAPI spec must have an 'openapi' field specifying the version as a string",
      suggestion: "Add the 'openapi' field at the top of your spec",
      examples: [
        'openapi: "3.1.0"  # For OpenAPI 3.1',
        'openapi: "3.0.3"  # For OpenAPI 3.0',
      ],
    });
  } else {
    version = s.openapi;
    if (!version.startsWith("3.0.") && !version.startsWith("3.1.")) {
      addError(`Unsupported OpenAPI version: ${version}`, {
        specFile: path,
        reason: "Steady only supports OpenAPI 3.0.x and 3.1.x specifications",
        suggestion: version.startsWith("2.")
          ? "Convert your Swagger 2.0 spec to OpenAPI 3.0+ using a migration tool"
          : `Update your spec to use a supported OpenAPI version (found: ${version})`,
        examples: [
          'openapi: "3.1.0"',
          'openapi: "3.0.3"',
        ],
      });
    }
  }

  // Validate info object
  let info: Record<string, unknown> | null = null;
  if (!s.info || typeof s.info !== "object" || Array.isArray(s.info)) {
    addError("Missing or invalid info object", {
      specFile: path,
      reason: "OpenAPI spec must have an 'info' object with API metadata",
      suggestion: "Add an 'info' object with title and version",
      examples: [
        "info:",
        "  title: My API",
        "  version: 1.0.0",
        "  description: A description of my API",
      ],
    });
  } else {
    info = s.info as Record<string, unknown>;

    if (typeof info.title !== "string") {
      addError("Missing API title", {
        specFile: path,
        reason: "The info object must have a 'title' field describing the API",
        suggestion: "Add a title to your info object",
        examples: [
          "info:",
          "  title: My API",
          "  version: 1.0.0",
        ],
      });
    }

    if (typeof info.version !== "string") {
      addError("Missing API version", {
        specFile: path,
        reason:
          "The info object must have a 'version' field indicating the API version",
        suggestion: "Add a version to your info object",
        examples: [
          "info:",
          "  title: My API",
          "  version: 1.0.0",
        ],
      });
    }
  }

  // Validate paths object
  if (!s.paths || typeof s.paths !== "object" || Array.isArray(s.paths)) {
    addError("Missing paths object", {
      specFile: path,
      reason:
        "OpenAPI spec must have a 'paths' object defining the API endpoints",
      suggestion: "Add a 'paths' object with your API endpoints",
      examples: [
        "paths:",
        "  /users:",
        "    get:",
        "      responses:",
        "        200:",
        "          description: Success",
      ],
    });
  }

  // OpenAPI 3.1-specific field validation
  // Validate these if version is 3.1 OR if these fields are present (implying 3.1 was intended)
  const is31 = version?.startsWith("3.1.") ?? false;
  const has31Fields = s.jsonSchemaDialect !== undefined ||
                      s.webhooks !== undefined ||
                      (s.components && typeof s.components === "object" &&
                       (s.components as Record<string, unknown>).pathItems !== undefined);

  if (is31 || has31Fields) {
    // Validate info.summary (optional but must be string if present)
    if (info && info.summary !== undefined && typeof info.summary !== "string") {
      addError("Invalid info summary", {
        specFile: path,
        reason: "The info.summary field must be a string",
        suggestion: "Change info.summary to a string value",
        examples: [
          "info:",
          "  title: My API",
          "  version: 1.0.0",
          "  summary: A brief description of my API",
        ],
      });
    }

    // Validate jsonSchemaDialect (optional but must be valid URI string if present)
    if (s.jsonSchemaDialect !== undefined) {
      if (typeof s.jsonSchemaDialect !== "string") {
        addError("Invalid jsonSchemaDialect", {
          specFile: path,
          reason: "The jsonSchemaDialect field must be a string",
          suggestion: "Provide a valid URI for jsonSchemaDialect",
          examples: [
            'jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base"',
          ],
        });
      } else {
        // Validate it's a valid URI (must start with http:// or https://)
        const dialect = s.jsonSchemaDialect;
        if (!dialect.startsWith("http://") && !dialect.startsWith("https://")) {
          addError("Invalid jsonSchemaDialect URI", {
            specFile: path,
            reason: "The jsonSchemaDialect must be a valid URI starting with http:// or https://",
            suggestion: "Provide a valid URI for jsonSchemaDialect",
            examples: [
              'jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base"',
              'jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema"',
            ],
          });
        }
      }
    }

    // Validate webhooks (optional but must be object if present)
    if (s.webhooks !== undefined && (typeof s.webhooks !== "object" || s.webhooks === null || Array.isArray(s.webhooks))) {
      addError("Invalid webhooks object", {
        specFile: path,
        reason: "The webhooks field must be an object",
        suggestion: "Define webhooks as an object with webhook definitions",
        examples: [
          "webhooks:",
          "  userRegistered:",
          "    post:",
          "      requestBody:",
          "        content:",
          "          application/json:",
          "            schema:",
          "              type: object",
        ],
      });
    }

    // Validate components.pathItems (optional but must be object if present)
    if (s.components && typeof s.components === "object" && !Array.isArray(s.components)) {
      const components = s.components as Record<string, unknown>;
      if (components.pathItems !== undefined && (typeof components.pathItems !== "object" || components.pathItems === null || Array.isArray(components.pathItems))) {
        addError("Invalid components.pathItems", {
          specFile: path,
          reason: "The components.pathItems field must be an object",
          suggestion: "Define pathItems as an object with reusable path item definitions",
          examples: [
            "components:",
            "  pathItems:",
            "    UserOperations:",
            "      get:",
            "        responses:",
            "          '200':",
            "            description: Success",
          ],
        });
      }
    }
  }

  // If we collected errors, throw appropriately
  if (errors.length > 0) {
    if (errors.length === 1) {
      throw errors[0]!;
    } else {
      throw new ValidationError(`Found ${errors.length} validation errors`, {
        specFile: path,
        errorType: "validate",
        reason: errors.map(e => e.message).join("; "),
        allErrors: errors,
      });
    }
  }

  // Validate OpenAPI 3.1.x specs against the metaschema
  // Note: OpenAPI 3.0.x uses a different JSON Schema dialect (draft-05), so we skip metaschema
  // validation for 3.0.x specs since our validator is tuned for JSON Schema 2020-12
  if (version?.startsWith("3.1.")) {
    const processor = new JsonSchemaProcessor();
    const validationResult = await processor.process(spec, {
      metaschema,
      baseUri: `file://${path}`,
    });

    if (!validationResult.valid && validationResult.errors.length > 0) {
      const error = validationResult.errors[0]!;
      throw new ValidationError("OpenAPI spec validation failed", {
        specFile: path,
        errorType: "validate",
        schemaPath: error.schemaPath.split("/").slice(1),
        reason: error.message,
        suggestion: error.suggestion,
      });
    }
  }

  return spec as OpenAPISpec;
}
