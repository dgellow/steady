import { parse as parseYAML } from "https://deno.land/std@0.208.0/yaml/parse.ts";
import { OpenAPISpec } from "./openapi.ts";
import { ParseError, ValidationError } from "./errors.ts";
import { getAllReferences, isValidReference } from "../json-pointer/mod.ts";
// import { JsonSchemaValidator } from "../json-schema/mod.ts";

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

  // Validate it's an object
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new ValidationError("Invalid OpenAPI spec structure", {
      specFile: path,
      errorType: "validate",
      reason: "OpenAPI spec must be an object, not " + typeof spec,
      expected: "object",
      actual: typeof spec,
      suggestion:
        "Ensure your spec file contains an OpenAPI object at the root level",
    });
  }

  // Comprehensive OpenAPI validation
  const errors: ValidationError[] = [];
  const anySpec = spec as Record<string, unknown>;

  // Check openapi version
  if (!("openapi" in spec) || typeof anySpec.openapi !== "string") {
    errors.push(
      new ValidationError("Missing or invalid OpenAPI version", {
        specFile: path,
        errorType: "validate",
        schemaPath: ["openapi"],
        reason: "OpenAPI spec must have an 'openapi' field with the version",
        expected: "string (e.g., '3.1.0')",
        actual: anySpec.openapi,
        suggestion: "Add the OpenAPI version to your spec",
        examples: ["openapi: 3.1.0"],
      }),
    );
  } else if (!anySpec.openapi.startsWith("3.")) {
    errors.push(
      new ValidationError("Unsupported OpenAPI version", {
        specFile: path,
        errorType: "validate",
        schemaPath: ["openapi"],
        reason:
          `Steady only supports OpenAPI 3.x, but found ${anySpec.openapi}`,
        expected: "3.x.x",
        actual: anySpec.openapi,
        suggestion: "Update your spec to use OpenAPI 3.x",
      }),
    );
  }

  // Check info
  if (
    !("info" in spec) || typeof anySpec.info !== "object" ||
    anySpec.info === null
  ) {
    errors.push(
      new ValidationError("Missing or invalid info object", {
        specFile: path,
        errorType: "validate",
        schemaPath: ["info"],
        reason: "OpenAPI spec must have an 'info' object",
        suggestion: "Add an info section to your spec",
        examples: [
          "info:",
          "  title: My API",
          "  version: 1.0.0",
        ],
      }),
    );
  } else {
    const info = anySpec.info as Record<string, unknown>;
    if (!info.title || typeof info.title !== "string") {
      errors.push(
        new ValidationError("Missing API title", {
          specFile: path,
          errorType: "validate",
          schemaPath: ["info", "title"],
          reason: "The info object must have a 'title' field",
          suggestion: "Add a title to your API",
          examples: ["title: My Amazing API"],
        }),
      );
    }

    if (!info.version || typeof info.version !== "string") {
      errors.push(
        new ValidationError("Missing API version", {
          specFile: path,
          errorType: "validate",
          schemaPath: ["info", "version"],
          reason: "The info object must have a 'version' field",
          suggestion: "Add a version to your API",
          examples: ["version: 1.0.0"],
        }),
      );
    }

    // Validate info.summary if present (OpenAPI 3.1 field)
    if ("summary" in info && typeof info.summary !== "string") {
      errors.push(
        new ValidationError("Invalid info summary", {
          specFile: path,
          errorType: "validate",
          schemaPath: ["info", "summary"],
          reason: "The info summary must be a string",
          suggestion: "Provide a string summary or remove the field",
          examples: ["summary: Brief description of the API"],
        }),
      );
    }
  }

  // Check paths
  if (
    !("paths" in spec) || typeof anySpec.paths !== "object" ||
    anySpec.paths === null || Array.isArray(anySpec.paths)
  ) {
    errors.push(
      new ValidationError("Missing paths object", {
        specFile: path,
        errorType: "validate",
        schemaPath: ["paths"],
        reason: "OpenAPI spec must have a 'paths' object",
        suggestion: "Add at least one path to your API",
        examples: [
          "paths:",
          "  /users:",
          "    get:",
          "      responses:",
          "        200:",
          "          description: Success",
        ],
      }),
    );
  }

  // Validate OpenAPI 3.1 specific fields

  // Validate jsonSchemaDialect if present
  if ("jsonSchemaDialect" in anySpec) {
    if (typeof anySpec.jsonSchemaDialect !== "string") {
      errors.push(
        new ValidationError("Invalid jsonSchemaDialect", {
          specFile: path,
          errorType: "validate",
          schemaPath: ["jsonSchemaDialect"],
          reason: "jsonSchemaDialect must be a string URI",
          suggestion: "Provide a valid JSON Schema dialect URI",
          examples: ["https://spec.openapis.org/oas/3.1/dialect/base"],
        }),
      );
    } else {
      // Basic URI validation
      try {
        new URL(anySpec.jsonSchemaDialect);
      } catch {
        errors.push(
          new ValidationError("Invalid jsonSchemaDialect URI", {
            specFile: path,
            errorType: "validate",
            schemaPath: ["jsonSchemaDialect"],
            reason: `"${anySpec.jsonSchemaDialect}" is not a valid URI`,
            suggestion: "Provide a valid JSON Schema dialect URI",
            examples: ["https://spec.openapis.org/oas/3.1/dialect/base"],
          }),
        );
      }
    }
  }

  // Validate webhooks if present
  if ("webhooks" in anySpec) {
    if (typeof anySpec.webhooks !== "object" || anySpec.webhooks === null) {
      errors.push(
        new ValidationError("Invalid webhooks object", {
          specFile: path,
          errorType: "validate",
          schemaPath: ["webhooks"],
          reason: "webhooks must be an object",
          suggestion: "Provide a valid webhooks object or remove the field",
          examples: [
            "webhooks:",
            "  myWebhook:",
            "    post:",
            "      requestBody:",
            "        content:",
            "          application/json:",
            "            schema:",
            "              type: object",
          ],
        }),
      );
    }
  }

  // Validate components.pathItems if present
  if (
    "components" in anySpec &&
    typeof anySpec.components === "object" &&
    anySpec.components !== null
  ) {
    const components = anySpec.components as Record<string, unknown>;
    if ("pathItems" in components) {
      if (
        typeof components.pathItems !== "object" ||
        components.pathItems === null
      ) {
        errors.push(
          new ValidationError("Invalid components.pathItems", {
            specFile: path,
            errorType: "validate",
            schemaPath: ["components", "pathItems"],
            reason: "components.pathItems must be an object",
            suggestion: "Provide a valid pathItems object or remove the field",
          }),
        );
      }
    }
  }

  // Validate all references
  const allRefs = getAllReferences(spec);
  for (const ref of allRefs) {
    if (ref.startsWith("#/")) {
      if (!isValidReference(spec, ref)) {
        errors.push(
          new ValidationError("Invalid reference", {
            specFile: path,
            errorType: "validate",
            schemaPath: [],
            reason: `Reference ${ref} could not be resolved`,
            suggestion: "Ensure the referenced component exists",
            examples: [
              "#/components/schemas/Pet",
              "#/components/responses/NotFound",
            ],
          }),
        );
      }
    }
  }

  // If we have validation errors, collect them all instead of throwing just the first
  if (errors.length > 0) {
    // Create a comprehensive error message
    const firstError = errors[0]!; // We know errors.length > 0
    const errorSummary = errors.length === 1
      ? firstError.message
      : `Found ${errors.length} validation errors:\n${
        errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
      }`;

    throw new ValidationError(errorSummary, {
      specFile: path,
      errorType: "validate",
      schemaPath: firstError.context.schemaPath,
      reason: errors.length === 1
        ? firstError.context.reason
        : `Multiple validation errors found`,
      suggestion: errors.length === 1
        ? firstError.context.suggestion
        : "Fix all validation errors listed above",
      allErrors: errors,
    });
  }

  return spec as OpenAPISpec;
}
