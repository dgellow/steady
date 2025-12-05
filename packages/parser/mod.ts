export { parseSpec, parseSpecFromFile } from "./parser.ts";
export type { ParseOptions } from "./parser.ts";
export { ParseError, SteadyError, SpecValidationError } from "./errors.ts";
// Backwards compatibility alias (deprecated)
export { SpecValidationError as ValidationError } from "./errors.ts";
export type { ErrorContext } from "./errors.ts";
export * from "./openapi.ts";
