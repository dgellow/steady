/**
 * JSON Pointer utilities for OpenAPI reference resolution
 */

/**
 * A JSON Pointer used as a URI fragment (RFC 3986 + RFC 6901).
 * Always starts with "#", e.g. "#/components/schemas/User" or "#" (root).
 *
 * Template literal type so bare pointers like "/foo" are a compile-time
 * error wherever a FragmentPointer is expected.
 */
export type FragmentPointer = `#${string}`;

/** Bare RFC 6901 pointer: "" (root) or "/foo/bar". */
export type JsonPointer = "" | `/${string}`;

/** Type guard: narrows a string to FragmentPointer if it starts with "#". */
export function isFragmentPointer(s: string): s is FragmentPointer {
  return s.startsWith("#");
}

/** Type guard: narrows a string to JsonPointer if it's "" or starts with "/". */
export function isJsonPointer(s: string): s is JsonPointer {
  return s === "" || s.startsWith("/");
}

export {
  escapeSegment,
  exists,
  formatFragmentPointer,
  formatPointer,
  JsonPointerError,
  listPointers,
  parseFragmentPointer,
  parsePointer,
  type PointerPath,
  resolve,
  set,
  unescapeSegment,
} from "./json-pointer.ts";

export { getOwn, hasOwn } from "./object.ts";

/** Type guard: narrows unknown to Record<string, unknown> for plain objects. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  explainInvalidRef,
  needsEscaping,
  type PointerValidationResult,
  validatePointer,
  validateRef,
} from "./rfc6901-validator.ts";
