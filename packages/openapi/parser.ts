import { parse as parseYAML } from "@std/yaml";
import { OpenAPISpec } from "./openapi.ts";
import { ErrorContext, ParseError, SpecValidationError } from "./errors.ts";

/**
 * Options for parsing OpenAPI specs
 */
export interface ParseOptions {
  /** Format hint: 'json', 'yaml', or 'auto' (default: 'auto') */
  format?: "json" | "yaml" | "auto";
}

/**
 * Result of parsing an OpenAPI spec.
 */
export interface ParseResult {
  spec: OpenAPISpec;
  /** Fields where the parser applied defaults (e.g., "openapi", "info.title"). */
  defaultedFields: string[];
}

/**
 * Parse an OpenAPI spec from a string.
 * This is the core parsing function - no file I/O, just pure parsing and validation.
 */
export function parseSpec(
  content: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
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
      suggestion: `Check that your content is valid ${
        isJSON ? "JSON" : "YAML"
      }`,
    });
  }

  // Validate and return (wrapped in Promise for backwards compatibility)
  return Promise.resolve(validateOpenAPISpec(spec));
}

/**
 * Load and parse an OpenAPI spec from a file or URL.
 * Convenience function that handles file/URL I/O and adds context to errors.
 */
export async function parseSpecFromFile(path: string): Promise<ParseResult> {
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
  try {
    return await parseSpec(content, { format });
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
 * Performs structural validation of required fields and version constraints.
 *
 * Lenient for metadata fields (E1003 territory): applies defaults for missing
 * openapi, info.title, info.version, and paths. Tracks which fields were
 * defaulted so the diagnostics system can produce E1003 warnings.
 *
 * Still throws for:
 * - Non-object spec (array/primitive). Structural invalidity
 * - Unsupported OpenAPI version (E1002 territory). Can't serve Swagger 2.0
 */
function validateOpenAPISpec(
  spec: unknown,
): ParseResult {
  // Basic structural validation - must be an object
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new SpecValidationError("Invalid OpenAPI spec structure", {
      errorType: "validate",
      reason: "OpenAPI spec must be an object, not an array or primitive value",
      suggestion: "Ensure your spec contains a valid OpenAPI object",
    });
  }

  const s = spec as Record<string, unknown>;
  const defaultedFields: string[] = [];

  // Validate openapi version field. Default if missing, throw if unsupported
  if (typeof s.openapi !== "string") {
    s.openapi = "3.1.0";
    defaultedFields.push("openapi");
  } else {
    const version = s.openapi;
    if (!version.startsWith("3.0.") && !version.startsWith("3.1.")) {
      throw new SpecValidationError(
        `Unsupported OpenAPI version: ${version}`,
        {
          errorType: "validate",
          reason: "Steady only supports OpenAPI 3.0.x and 3.1.x specifications",
          suggestion: version.startsWith("2.")
            ? "Convert your Swagger 2.0 spec to OpenAPI 3.0+ using a migration tool"
            : `Update your spec to use a supported OpenAPI version (found: ${version})`,
        },
      );
    }
  }

  const version = s.openapi as string;

  // Validate info object. Apply defaults for missing metadata
  if (!s.info || typeof s.info !== "object" || Array.isArray(s.info)) {
    s.info = { title: "Untitled API", version: "unknown" };
    defaultedFields.push("info");
  } else {
    const info = s.info as Record<string, unknown>;

    if (typeof info.title !== "string") {
      info.title = "Untitled API";
      defaultedFields.push("info.title");
    }

    if (typeof info.version !== "string") {
      info.version = "unknown";
      defaultedFields.push("info.version");
    }
  }

  // OpenAPI 3.1-specific field validation
  const is31 = version.startsWith("3.1.");

  // Validate paths object. Default to empty if missing
  const hasPaths = s.paths && typeof s.paths === "object" &&
    !Array.isArray(s.paths);

  if (!hasPaths) {
    s.paths = {};
    defaultedFields.push("paths");
  }
  const has31Fields = s.jsonSchemaDialect !== undefined ||
    s.webhooks !== undefined ||
    (s.components && typeof s.components === "object" &&
      (s.components as Record<string, unknown>).pathItems !== undefined);

  const info = s.info as Record<string, unknown>;
  const errors: SpecValidationError[] = [];

  function addError(message: string, context: Omit<ErrorContext, "errorType">) {
    errors.push(
      new SpecValidationError(message, { ...context, errorType: "validate" }),
    );
  }

  if (is31 || has31Fields) {
    // Validate info.summary
    if (
      info.summary !== undefined && typeof info.summary !== "string"
    ) {
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
            reason:
              "The jsonSchemaDialect must be a valid URI starting with http:// or https://",
            suggestion: "Provide a valid URI for jsonSchemaDialect",
          });
        }
      }
    }

    // Validate webhooks
    if (
      s.webhooks !== undefined &&
      (typeof s.webhooks !== "object" || s.webhooks === null ||
        Array.isArray(s.webhooks))
    ) {
      addError("Invalid webhooks object", {
        reason: "The webhooks field must be an object",
        suggestion: "Define webhooks as an object with webhook definitions",
      });
    }

    // Validate components.pathItems
    if (
      s.components && typeof s.components === "object" &&
      !Array.isArray(s.components)
    ) {
      const components = s.components as Record<string, unknown>;
      if (
        components.pathItems !== undefined &&
        (typeof components.pathItems !== "object" ||
          components.pathItems === null || Array.isArray(components.pathItems))
      ) {
        addError("Invalid components.pathItems", {
          reason: "The components.pathItems field must be an object",
          suggestion:
            "Define pathItems as an object with reusable path item definitions",
        });
      }
    }
  }

  // Throw collected errors (structural issues that prevent serving)
  if (errors.length > 0) {
    if (errors.length === 1) {
      throw errors[0]!;
    } else {
      throw new SpecValidationError(
        `Found ${errors.length} validation errors`,
        {
          errorType: "validate",
          reason: errors.map((e) => e.message).join("; "),
          allErrors: errors,
        },
      );
    }
  }

  return { spec: spec as OpenAPISpec, defaultedFields };
}
