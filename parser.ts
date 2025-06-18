import { parse as parseYAML } from "https://deno.land/std@0.208.0/yaml/parse.ts";
import { OpenAPISpec } from "./types.ts";
import { ParseError, ValidationError } from "./errors.ts";

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
          "openapi: 3.0.0",
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

  // Basic OpenAPI validation
  const errors: ValidationError[] = [];
  const anySpec = spec as any;

  // Check openapi version
  if (!("openapi" in spec) || typeof anySpec.openapi !== "string") {
    errors.push(
      new ValidationError("Missing or invalid OpenAPI version", {
        specFile: path,
        errorType: "validate",
        schemaPath: ["openapi"],
        reason: "OpenAPI spec must have an 'openapi' field with the version",
        expected: "string (e.g., '3.0.0')",
        actual: anySpec.openapi,
        suggestion: "Add the OpenAPI version to your spec",
        examples: ["openapi: 3.0.0"],
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
        suggestion: "Update your spec to use OpenAPI 3.0.0 or later",
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
    if (!anySpec.info.title || typeof anySpec.info.title !== "string") {
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

    if (!anySpec.info.version || typeof anySpec.info.version !== "string") {
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
  }

  // Check paths
  if (
    !("paths" in spec) || typeof anySpec.paths !== "object" ||
    anySpec.paths === null
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

  // If we have validation errors, throw them
  if (errors.length > 0) {
    // For now, just throw the first error
    // In a more complete implementation, we'd collect all errors
    throw errors[0];
  }

  return spec as OpenAPISpec;
}
