import { parse as parseYAML } from "@std/yaml";
import { OpenAPISpec } from "./openapi.ts";
import { ParseError } from "./errors.ts";
// import { JsonSchemaProcessor, type Schema } from "../json-schema/mod.ts";
// import metaschemaJson from "./schemas/openapi-3.1.json" with { type: "json" };

// const metaschema = metaschemaJson as unknown as Schema;

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

  // TODO: Re-enable metaschema validation once validator_legacy.ts fully supports
  // unevaluatedProperties/unevaluatedItems (currently 91.6% JSON Schema compliant)
  // For now, skip metaschema validation to avoid false positives
  //
  // const processor = new JsonSchemaProcessor();
  // const validationResult = await processor.process(spec, {
  //   metaschema,
  //   baseUri: `file://${path}`,
  // });
  //
  // if (!validationResult.valid) {
  //   const error = validationResult.errors[0]!;
  //   throw new ValidationError("OpenAPI spec validation failed", {
  //     specFile: path,
  //     errorType: "validate",
  //     schemaPath: error.schemaPath.split("/").slice(1),
  //     reason: error.message,
  //     suggestion: error.suggestion,
  //   });
  // }

  // Basic structural validation
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new ParseError("Invalid OpenAPI spec", {
      specFile: path,
      errorType: "parse",
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

  // Validate openapi version field
  if (typeof s.openapi !== "string") {
    throw new ParseError("Missing 'openapi' version field", {
      specFile: path,
      errorType: "parse",
      reason:
        "Every OpenAPI spec must have an 'openapi' field specifying the version",
      suggestion: "Add the 'openapi' field at the top of your spec",
      examples: [
        'openapi: "3.1.0"  # For OpenAPI 3.1',
        'openapi: "3.0.3"  # For OpenAPI 3.0',
      ],
    });
  }

  const version = s.openapi;
  if (!version.startsWith("3.0.") && !version.startsWith("3.1.")) {
    throw new ParseError(`Unsupported OpenAPI version: ${version}`, {
      specFile: path,
      errorType: "parse",
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

  // Validate info object
  if (!s.info || typeof s.info !== "object" || Array.isArray(s.info)) {
    throw new ParseError("Missing or invalid 'info' object", {
      specFile: path,
      errorType: "parse",
      reason: "OpenAPI spec must have an 'info' object with API metadata",
      suggestion: "Add an 'info' object with title and version",
      examples: [
        "info:",
        "  title: My API",
        "  version: 1.0.0",
        "  description: A description of my API",
      ],
    });
  }

  const info = s.info as Record<string, unknown>;
  if (typeof info.title !== "string") {
    throw new ParseError("Missing 'info.title' field", {
      specFile: path,
      errorType: "parse",
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
    throw new ParseError("Missing 'info.version' field", {
      specFile: path,
      errorType: "parse",
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

  // Validate paths object
  if (!s.paths || typeof s.paths !== "object" || Array.isArray(s.paths)) {
    throw new ParseError("Missing or invalid 'paths' object", {
      specFile: path,
      errorType: "parse",
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

  return spec as OpenAPISpec;
}
