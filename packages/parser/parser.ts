import { parse as parseYAML } from "@std/yaml";
import { OpenAPISpec } from "./openapi.ts";
import { ParseError, SpecValidationError, ErrorContext } from "./errors.ts";
import { JsonSchemaProcessor, type Schema } from "../json-schema/mod.ts";
import metaschemaJson from "./schemas/openapi-3.1.json" with { type: "json" };

const metaschema = metaschemaJson as unknown as Schema;

/**
 * Options for parsing OpenAPI specs
 */
export interface ParseOptions {
  /** Format hint: 'json', 'yaml', or 'auto' (default: 'auto') */
  format?: "json" | "yaml" | "auto";
  /** Base URI for resolving references (optional) */
  baseUri?: string;
}

/**
 * Parse an OpenAPI spec from a string.
 * This is the core parsing function - no file I/O, just pure parsing and validation.
 */
export function parseSpec(
  content: string,
  options: ParseOptions = {},
): Promise<OpenAPISpec> {
  const format = options.format ?? "auto";

  // Parse content based on format
  // Use "json" schema to prevent YAML from auto-converting date-like strings to Date objects
  // This ensures "2022-11-15" stays as a string, not a Date
  let spec: unknown;
  try {
    if (format === "json") {
      spec = JSON.parse(content);
    } else if (format === "yaml") {
      spec = parseYAML(content, { schema: "json" });
    } else {
      // Auto-detect: try YAML first (superset of JSON), then JSON
      try {
        spec = parseYAML(content, { schema: "json" });
      } catch {
        spec = JSON.parse(content);
      }
    }
  } catch (error) {
    const isJSON = format === "json" || content.trimStart().startsWith("{");
    throw new ParseError(`Invalid ${isJSON ? "JSON" : "YAML"} syntax`, {
      errorType: "parse",
      reason: `Failed to parse content: ${
        error instanceof Error ? error.message : String(error)
      }`,
      suggestion: `Check that your content is valid ${isJSON ? "JSON" : "YAML"}`,
    });
  }

  // Validate and return
  return validateOpenAPISpec(spec, options.baseUri);
}

/**
 * Load and parse an OpenAPI spec from a file or URL.
 * Convenience function that handles file/URL I/O and adds context to errors.
 */
export async function parseSpecFromFile(path: string): Promise<OpenAPISpec> {
  const isUrl = path.startsWith("http://") || path.startsWith("https://");

  // Read content from file or URL
  let content: string;
  if (isUrl) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new ParseError("Failed to fetch OpenAPI spec", {
          specFile: path,
          errorType: "parse",
          reason: `HTTP ${response.status}: ${response.statusText}`,
          suggestion: "Check that the URL is correct and accessible",
        });
      }
      content = await response.text();
    } catch (error) {
      if (error instanceof ParseError) throw error;
      throw new ParseError("Failed to fetch OpenAPI spec", {
        specFile: path,
        errorType: "parse",
        reason: `Could not fetch URL: ${
          error instanceof Error ? error.message : String(error)
        }`,
        suggestion: "Check that the URL is correct and you have network access",
      });
    }
  } else {
    try {
      content = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ParseError("OpenAPI spec file not found", {
          specFile: path,
          errorType: "parse",
          reason: `The file "${path}" does not exist`,
          suggestion: "Check that the file path is correct and the file exists",
        });
      }
      throw new ParseError("Failed to read OpenAPI spec file", {
        specFile: path,
        errorType: "parse",
        reason: `Could not read file: ${
          error instanceof Error ? error.message : String(error)
        }`,
        suggestion: "Check that you have permission to read the file",
      });
    }
  }

  // Determine format from extension/URL
  const ext = path.toLowerCase();
  let format: "json" | "yaml" | "auto" = "auto";
  if (ext.endsWith(".json")) {
    format = "json";
  } else if (ext.endsWith(".yaml") || ext.endsWith(".yml")) {
    format = "yaml";
  }

  // Parse with context
  const baseUri = isUrl ? path : `file://${path}`;
  try {
    return await parseSpec(content, {
      format,
      baseUri,
    });
  } catch (error) {
    // Add file context to errors
    if (error instanceof ParseError || error instanceof SpecValidationError) {
      error.context.specFile = path;
    }
    throw error;
  }
}

/**
 * Validate a parsed object as an OpenAPI spec.
 * Performs structural validation and OpenAPI 3.1 metaschema validation.
 */
async function validateOpenAPISpec(
  spec: unknown,
  baseUri?: string,
): Promise<OpenAPISpec> {
  // Basic structural validation - must be an object
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new SpecValidationError("Invalid OpenAPI spec structure", {
      errorType: "validate",
      reason: "OpenAPI spec must be an object, not an array or primitive value",
      suggestion: "Ensure your spec contains a valid OpenAPI object",
    });
  }

  const s = spec as Record<string, unknown>;
  const errors: SpecValidationError[] = [];

  // Helper to collect validation errors
  function addError(message: string, context: Omit<ErrorContext, "errorType">) {
    errors.push(new SpecValidationError(message, { ...context, errorType: "validate" }));
  }

  // Validate openapi version field
  let version: string | null = null;
  if (typeof s.openapi !== "string") {
    addError("Missing or invalid OpenAPI version", {
      reason: "Every OpenAPI spec must have an 'openapi' field specifying the version as a string",
      suggestion: "Add the 'openapi' field at the top of your spec",
    });
  } else {
    version = s.openapi;
    if (!version.startsWith("3.0.") && !version.startsWith("3.1.")) {
      addError(`Unsupported OpenAPI version: ${version}`, {
        reason: "Steady only supports OpenAPI 3.0.x and 3.1.x specifications",
        suggestion: version.startsWith("2.")
          ? "Convert your Swagger 2.0 spec to OpenAPI 3.0+ using a migration tool"
          : `Update your spec to use a supported OpenAPI version (found: ${version})`,
      });
    }
  }

  // Validate info object
  let info: Record<string, unknown> | null = null;
  if (!s.info || typeof s.info !== "object" || Array.isArray(s.info)) {
    addError("Missing or invalid info object", {
      reason: "OpenAPI spec must have an 'info' object with API metadata",
      suggestion: "Add an 'info' object with title and version",
    });
  } else {
    info = s.info as Record<string, unknown>;

    if (typeof info.title !== "string") {
      addError("Missing API title", {
        reason: "The info object must have a 'title' field describing the API",
        suggestion: "Add a title to your info object",
      });
    }

    // Validate version field
    // Note: Using schema:"json" in YAML parser prevents date-like strings from being converted to Date
    if (typeof info.version !== "string") {
      addError("Missing API version", {
        reason: "The info object must have a 'version' field indicating the API version",
        suggestion: "Add a version to your info object",
      });
    }
  }

  // OpenAPI 3.1-specific field validation
  const is31 = version?.startsWith("3.1.") ?? false;

  // Validate paths object
  // In 3.0.x: paths is required
  // In 3.1.x: paths is optional if webhooks or components exists
  const hasPaths = s.paths && typeof s.paths === "object" && !Array.isArray(s.paths);
  const hasWebhooks = s.webhooks && typeof s.webhooks === "object" && !Array.isArray(s.webhooks);
  const hasComponents = s.components && typeof s.components === "object" && !Array.isArray(s.components);

  if (!hasPaths) {
    if (is31) {
      // OpenAPI 3.1: need at least one of paths, webhooks, or components
      if (!hasWebhooks && !hasComponents) {
        addError("Missing paths, webhooks, or components", {
          reason: "OpenAPI 3.1 spec must have at least one of: paths, webhooks, or components",
          suggestion: "Add a 'paths' object with your API endpoints, or 'webhooks' for webhook definitions",
        });
      }
    } else {
      // OpenAPI 3.0.x: paths is required
      addError("Missing paths object", {
        reason: "OpenAPI 3.0.x spec must have a 'paths' object defining the API endpoints",
        suggestion: "Add a 'paths' object with your API endpoints",
      });
    }
  }
  const has31Fields = s.jsonSchemaDialect !== undefined ||
                      s.webhooks !== undefined ||
                      (s.components && typeof s.components === "object" &&
                       (s.components as Record<string, unknown>).pathItems !== undefined);

  if (is31 || has31Fields) {
    // Validate info.summary
    if (info && info.summary !== undefined && typeof info.summary !== "string") {
      addError("Invalid info summary", {
        reason: "The info.summary field must be a string",
        suggestion: "Change info.summary to a string value",
      });
    }

    // Validate jsonSchemaDialect
    if (s.jsonSchemaDialect !== undefined) {
      if (typeof s.jsonSchemaDialect !== "string") {
        addError("Invalid jsonSchemaDialect", {
          reason: "The jsonSchemaDialect field must be a string",
          suggestion: "Provide a valid URI for jsonSchemaDialect",
        });
      } else {
        const dialect = s.jsonSchemaDialect;
        if (!dialect.startsWith("http://") && !dialect.startsWith("https://")) {
          addError("Invalid jsonSchemaDialect URI", {
            reason: "The jsonSchemaDialect must be a valid URI starting with http:// or https://",
            suggestion: "Provide a valid URI for jsonSchemaDialect",
          });
        }
      }
    }

    // Validate webhooks
    if (s.webhooks !== undefined && (typeof s.webhooks !== "object" || s.webhooks === null || Array.isArray(s.webhooks))) {
      addError("Invalid webhooks object", {
        reason: "The webhooks field must be an object",
        suggestion: "Define webhooks as an object with webhook definitions",
      });
    }

    // Validate components.pathItems
    if (s.components && typeof s.components === "object" && !Array.isArray(s.components)) {
      const components = s.components as Record<string, unknown>;
      if (components.pathItems !== undefined && (typeof components.pathItems !== "object" || components.pathItems === null || Array.isArray(components.pathItems))) {
        addError("Invalid components.pathItems", {
          reason: "The components.pathItems field must be an object",
          suggestion: "Define pathItems as an object with reusable path item definitions",
        });
      }
    }
  }

  // Throw collected errors
  if (errors.length > 0) {
    if (errors.length === 1) {
      throw errors[0]!;
    } else {
      throw new SpecValidationError(`Found ${errors.length} validation errors`, {
        errorType: "validate",
        reason: errors.map(e => e.message).join("; "),
        allErrors: errors,
      });
    }
  }

  // Metaschema validation for OpenAPI 3.1.x
  if (version?.startsWith("3.1.")) {
    const processor = new JsonSchemaProcessor();
    const validationResult = await processor.process(spec, {
      metaschema,
      baseUri,
    });

    if (!validationResult.valid && validationResult.errors.length > 0) {
      const error = validationResult.errors[0]!;
      const isRefError = error.type === "ref-not-found" ||
                         error.keyword === "$ref" ||
                         error.message.toLowerCase().includes("ref");
      throw new SpecValidationError(
        isRefError ? "Invalid reference in OpenAPI spec" : "OpenAPI spec validation failed",
        {
          errorType: "validate",
          schemaPath: error.schemaPath.split("/").slice(1),
          reason: error.message,
          suggestion: error.suggestion,
        },
      );
    }
  }

  return spec as OpenAPISpec;
}
