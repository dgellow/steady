/**
 * JSON Pointer utilities for OpenAPI reference resolution
 */

export {
  escapeSegment,
  exists,
  formatPointer,
  JsonPointerError,
  listPointers,
  parsePointer,
  resolve,
  set,
  unescapeSegment,
} from "./json-pointer.ts";

export {
  findCircularReferences,
  getAllReferences,
  isValidReference,
  resolveReference,
} from "./resolver.ts";

export {
  explainInvalidRef,
  needsEscaping,
  validatePointer,
  validateRef,
  type ValidationResult,
} from "./rfc6901-validator.ts";
