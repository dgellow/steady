export { OpenAPISpec } from "./spec.ts";
export { parseSpec, parseSpecFromFile } from "./parser.ts";
export { normalizeSpecShape, type ShapeProblem } from "./shape.ts";
export type { ParseOptions, ParseResult } from "./parser.ts";
export { ParseError, SpecValidationError, SteadyError } from "./errors.ts";
// Backwards compatibility alias (deprecated)
export { SpecValidationError as ValidationError } from "./errors.ts";
export type { ErrorContext } from "./errors.ts";
export * from "./openapi.ts";
export { resolvePartContentTypes } from "./multipart.ts";
import _metaschema from "./schemas/openapi-3.1.json" with { type: "json" };

/**
 * The OpenAPI 3.1 metaschema for validating OpenAPI 3.1 specs.
 * Exported with its natural JSON import type. SchemaSource.metaschema
 * accepts `unknown`, so no casting is needed at this boundary.
 * MetaschemaValidator narrows via isSchema internally.
 */
export const openapi31Metaschema = _metaschema;
