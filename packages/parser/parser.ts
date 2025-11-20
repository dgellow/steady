import { parse as parseYAML } from "https://deno.land/std@0.208.0/yaml/parse.ts";
import { OpenAPISpec } from "./openapi.ts";
import { ParseError, ValidationError } from "./errors.ts";
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

  return spec as OpenAPISpec;
}
