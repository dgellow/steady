import { parse as parseYAML } from "@std/yaml";
import {
  formatFragmentPointer,
  inspectDocument,
  isPlainObject,
  type PointerPath,
} from "@steady/json-pointer";
import { OpenAPIRaw } from "./openapi.ts";
import { ErrorContext, ParseError, SpecValidationError } from "./errors.ts";

/** Minimal timer interface for startup instrumentation. */
interface Timer {
  start(name: string): void;
  stop(name: string): void;
}

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
  spec: OpenAPIRaw;
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
  timer?: Timer,
): Promise<ParseResult> {
  const format = options.format ?? "auto";

  // Parse content based on format
  // Use "json" schema to prevent YAML from auto-converting date-like strings to Date objects
  // This ensures "2022-11-15" stays as a string, not a Date
  timer?.start("yaml");
  let spec: unknown;
  try {
    if (format === "json") {
      spec = JSON.parse(content);
    } else if (content.trimStart().startsWith("{")) {
      // Content is JSON regardless of file extension. JSON.parse is ~10x
      // faster than the YAML parser for large documents.
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
    timer?.stop("yaml");
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

  timer?.stop("yaml");

  timer?.start("shape");
  try {
    assertTreeShaped(spec);
  } finally {
    timer?.stop("shape");
  }

  // Validate and return (wrapped in Promise for backwards compatibility)
  timer?.start("validate");
  const result = validateOpenAPIRaw(spec);
  timer?.stop("validate");
  return Promise.resolve(result);
}

/**
 * Levels of nesting accepted in a document. Everything that reads the
 * document recurses along its structure, so the limit has to stay well
 * below the depth at which the call stack runs out (measured: between
 * 3 000 and 5 000 levels). Real specs nest a few dozen levels.
 */
export const MAX_DOCUMENT_DEPTH = 1000;

/**
 * Limits on what YAML aliases may expand to. A document is rejected when,
 * written out as a tree, it has more than `MAX_EXPANDED_NODES` objects and
 * arrays AND more than `MAX_EXPANSION_FACTOR` times its distinct ones. The
 * first number lets small documents reuse anchors freely, the second lets
 * large documents be large.
 */
export const MAX_EXPANDED_NODES = 1_000_000;
export const MAX_EXPANSION_FACTOR = 10;

/** A pointer for an error message. Deep paths are cut after their start. */
function pointerForMessage(path: PointerPath): string {
  const shown = path.length > 12 ? path.slice(0, 12) : path;
  const pointer = formatFragmentPointer(shown);
  return path.length > shown.length
    ? `${pointer}/... (${path.length} segments)`
    : pointer;
}

/**
 * Reject a document that cannot be read as a tree.
 *
 * JSON always parses to a tree. YAML does not: an alias makes two keys hold
 * the same object, and an alias to an ancestor makes an object contain
 * itself. All code below this boundary walks the document by its keys. On a
 * cyclic document that never ends, and on nested aliases it repeats the
 * shared part once per path, which is exponential ("billion laughs").
 * Checking once here keeps every reader of the document simple and safe.
 */
function assertTreeShaped(document: unknown): void {
  const shape = inspectDocument(document);

  if (shape.cycle) {
    throw new ParseError("Document contains itself", {
      errorType: "parse",
      reason: `The value at ${
        pointerForMessage(shape.cycle.path)
      } is a YAML alias to ${
        pointerForMessage(shape.cycle.ancestor)
      }, which contains it. An OpenAPI document must be representable as JSON, and a value that contains itself is not`,
      suggestion:
        "Use $ref for a recursive schema, for example $ref: '#/components/schemas/Node'. A $ref may be recursive, a YAML alias may not",
    });
  }

  if (shape.depth > MAX_DOCUMENT_DEPTH) {
    throw new ParseError("Document is nested too deeply", {
      errorType: "parse",
      reason: `Nesting reaches ${shape.depth} levels at ${
        pointerForMessage(shape.deepestPath)
      }. Steady reads documents up to ${MAX_DOCUMENT_DEPTH} levels deep`,
      suggestion:
        "Move nested schemas to components/schemas and refer to them with $ref",
    });
  }

  if (
    shape.expandedNodes > MAX_EXPANDED_NODES &&
    shape.expandedNodes > shape.nodes * MAX_EXPANSION_FACTOR
  ) {
    const expanded = Number.isFinite(shape.expandedNodes)
      ? String(shape.expandedNodes)
      : "more than 1e308";
    throw new ParseError("YAML aliases expand to too many values", {
      errorType: "parse",
      reason:
        `The document defines ${shape.nodes} objects and arrays, but its YAML aliases repeat them: written out as JSON it has ${expanded}. Steady accepts up to ${MAX_EXPANDED_NODES}, or ${MAX_EXPANSION_FACTOR} times the number defined, whichever is larger`,
      suggestion:
        "Use $ref instead of YAML aliases for schemas that are reused inside each other",
    });
  }
}

/**
 * Load and parse an OpenAPI spec from a file or URL.
 * Convenience function that handles file/URL I/O and adds context to errors.
 */
export async function parseSpecFromFile(
  path: string,
  timer?: Timer,
): Promise<ParseResult> {
  const isUrl = path.startsWith("http://") || path.startsWith("https://");

  // Read content from file or URL
  timer?.start("io");
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

  timer?.stop("io");

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
    return await parseSpec(content, { format }, timer);
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
function validateOpenAPIRaw(
  spec: unknown,
): ParseResult {
  // Basic structural validation - must be an object
  if (!isPlainObject(spec)) {
    throw new SpecValidationError("Invalid OpenAPI spec structure", {
      errorType: "validate",
      reason: "OpenAPI spec must be an object, not an array or primitive value",
      suggestion: "Ensure your spec contains a valid OpenAPI object",
    });
  }

  const s = spec;
  const defaultedFields: string[] = [];

  // Validate openapi version field. Default if missing, throw if unsupported
  if (typeof s.openapi !== "string") {
    s.openapi = "3.1.0";
    defaultedFields.push("openapi");
  } else {
    if (!s.openapi.startsWith("3.0.") && !s.openapi.startsWith("3.1.")) {
      throw new SpecValidationError(
        `Unsupported OpenAPI version: ${s.openapi}`,
        {
          errorType: "validate",
          reason: "Steady only supports OpenAPI 3.0.x and 3.1.x specifications",
          suggestion: s.openapi.startsWith("2.")
            ? "Convert your Swagger 2.0 spec to OpenAPI 3.0+ using a migration tool"
            : `Update your spec to use a supported OpenAPI version (found: ${s.openapi})`,
        },
      );
    }
  }

  // After validation, openapi is guaranteed to be a string
  const version = String(s.openapi);

  // Validate info object. Apply defaults for missing metadata
  if (!isPlainObject(s.info)) {
    s.info = { title: "Untitled API", version: "unknown" };
    defaultedFields.push("info");
  } else {
    if (typeof s.info.title !== "string") {
      s.info.title = "Untitled API";
      defaultedFields.push("info.title");
    }

    if (typeof s.info.version !== "string") {
      s.info.version = "unknown";
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
    (isPlainObject(s.components) && s.components.pathItems !== undefined);

  // s.info was validated/defaulted above to always be a plain object
  const info = isPlainObject(s.info) ? s.info : { title: "", version: "" };
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
    if (isPlainObject(s.components)) {
      if (
        s.components.pathItems !== undefined &&
        !isPlainObject(s.components.pathItems)
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
    const first = errors[0];
    if (errors.length === 1 && first) {
      throw first;
    }
    throw new SpecValidationError(
      `Found ${errors.length} validation errors`,
      {
        errorType: "validate",
        reason: errors.map((e) => e.message).join("; "),
        allErrors: errors,
      },
    );
  }

  // The function validated and defaulted all required OpenAPIRaw fields
  // (openapi, info.title, info.version, paths). This type guard bridges
  // the validated Record to the typed interface.
  if (!isOpenAPIRaw(s)) {
    throw new SpecValidationError(
      "Spec validation produced invalid structure",
      {
        errorType: "validate",
        reason:
          "Internal error: validated spec does not match OpenAPIRaw shape",
      },
    );
  }
  return { spec: s, defaultedFields };
}

/** Type guard for the validation boundary: checks the 3 required OpenAPIRaw fields. */
function isOpenAPIRaw(
  value: Record<string, unknown>,
): value is Record<string, unknown> & OpenAPIRaw {
  return (
    typeof value.openapi === "string" &&
    isPlainObject(value.info) &&
    typeof value.info.title === "string" &&
    typeof value.info.version === "string" &&
    isPlainObject(value.paths)
  );
}
