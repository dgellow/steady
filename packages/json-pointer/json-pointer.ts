/**
 * JSON Pointer implementation following RFC 6901
 * https://tools.ietf.org/html/rfc6901
 */

import type { FragmentPointer } from "./mod.ts";
import { hasOwn } from "./object.ts";

/**
 * A JSON Pointer expressed as an array of decoded path segments.
 *
 * This is the structured representation used inside traversal and
 * building logic. `FragmentPointer` strings are parsed into a
 * `PointerPath` at the incoming boundary and formatted back into a
 * `FragmentPointer` only at the outgoing boundary.
 *
 * Segments are stored in their RFC 6901 decoded form: a segment that
 * contains "/" is stored as "foo/bar", not "foo~1bar"; a segment that
 * contains "~" is stored as "foo~bar", not "foo~0bar". Escaping happens
 * only inside `formatFragmentPointer` / `formatPointer`.
 *
 * `readonly` so that recursive walkers can share a base path and append
 * via `[...path, segment]` without risk of aliasing mutation.
 */
export type PointerPath = readonly string[];

export class JsonPointerError extends Error {
  constructor(message: string, public pointer: string) {
    super(message);
    this.name = "JsonPointerError";
  }
}

/**
 * Type guard: narrows `object` (after Array.isArray check) to
 * Record<string, unknown>. Used throughout to avoid `as Record` casts.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate that a string is a valid RFC 6901 array index.
 * Valid indices: "0", "1", "12", "123", etc.
 * Invalid: "01" (leading zero), "1.5" (decimal), "-1" (negative), " 1" (spaces)
 */
function isValidArrayIndex(segment: string): boolean {
  // Must be either "0" or a number starting with non-zero digit
  // This regex matches: "0" or "[1-9][0-9]*"
  return /^(0|[1-9][0-9]*)$/.test(segment);
}

/**
 * Strip fragment prefix and percent-decode if pointer starts with "#".
 * Returns a bare RFC 6901 pointer suitable for parsePointer().
 */
function toBarePointer(pointer: string): string {
  if (pointer.startsWith("#")) {
    try {
      return decodeURIComponent(pointer.slice(1));
    } catch {
      throw new JsonPointerError(
        `Invalid percent encoding in pointer: ${pointer}`,
        pointer,
      );
    }
  }
  return pointer;
}

/**
 * Parse a JSON Pointer string into an array of path segments
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new JsonPointerError(
      "JSON Pointer must start with '/' or be empty string",
      pointer,
    );
  }

  return pointer
    .slice(1) // Remove leading "/"
    .split("/")
    .map(unescapeSegment);
}

/**
 * Escape a path segment according to RFC 6901
 */
export function escapeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Unescape a path segment according to RFC 6901
 *
 * RFC 6901 ONLY defines two escape sequences:
 * - ~0 represents ~ (tilde)
 * - ~1 represents / (slash)
 *
 * Percent-encoding (like %20 for space) is NOT part of RFC 6901.
 * JSON Pointer treats percent sequences as literal characters.
 */
export function unescapeSegment(segment: string): string {
  // Apply JSON Pointer unescaping ONLY (~1 -> /, ~0 -> ~)
  // Order matters: ~1 must be replaced before ~0
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Convert an array of path segments to a JSON Pointer string
 */
export function formatPointer(segments: readonly string[]): string {
  if (segments.length === 0) {
    return "";
  }
  return "/" + segments.map(escapeSegment).join("/");
}

/**
 * Parse a `FragmentPointer` into a structured `PointerPath`.
 *
 * This is the "incoming boundary" function: use it once, at the point
 * a raw pointer string enters the logic, then pass the `PointerPath`
 * through the rest of the call graph.
 *
 * Handles both layers of decoding: RFC 3986 percent-decoding (the
 * fragment identifier layer) and RFC 6901 segment unescaping.
 *
 * Examples:
 *   "#"                       → []
 *   "#/foo/bar"               → ["foo", "bar"]
 *   "#/a~1b/c~0d"             → ["a/b", "c~d"]
 *   "#/User%20Name"           → ["User Name"]
 */
export function parseFragmentPointer(pointer: FragmentPointer): PointerPath {
  return parsePointer(toBarePointer(pointer));
}

/**
 * Format a structured `PointerPath` as a `FragmentPointer`.
 *
 * This is the "outgoing boundary" function: use it only at the point
 * a structured path needs to leave the logic (stored in a diagnostic,
 * sent in a response, printed to the terminal, looked up in the
 * registry).
 *
 * Segments are RFC 6901 escaped. Percent-encoding is not applied: our
 * `parseFragmentPointer` accepts both forms and most downstream tools
 * do the same.
 *
 * Examples:
 *   []                        → "#"
 *   ["foo", "bar"]            → "#/foo/bar"
 *   ["a/b", "c~d"]            → "#/a~1b/c~0d"
 */
export function formatFragmentPointer(path: PointerPath): FragmentPointer {
  if (path.length === 0) return "#";
  return `#${formatPointer(path)}`;
}

/**
 * Resolve a JSON Pointer against a document.
 * Accepts both bare RFC 6901 pointers ("/foo/bar") and
 * URI fragment pointers ("#/foo/bar").
 *
 * Fragment pointers (starting with "#") are percent-decoded per RFC 3986
 * before JSON Pointer resolution. Bare pointers are used as-is.
 */
export function resolve(document: unknown, pointer: string): unknown {
  const bare = toBarePointer(pointer);
  const segments = parsePointer(bare);
  let current = document;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) {
      throw new JsonPointerError(
        `Invalid pointer: undefined segment at index ${i}`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }

    if (current === null || current === undefined) {
      throw new JsonPointerError(
        `Cannot resolve pointer at segment '${segment}': current value is null/undefined`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }

    if (Array.isArray(current)) {
      // Array index
      if (segment === "-") {
        // Special case: "-" refers to the (nonexistent) element after the last
        throw new JsonPointerError(
          "Cannot resolve '-' array index during read operation",
          formatPointer(segments.slice(0, i + 1)),
        );
      }

      // RFC 6901: Array indices must be non-negative integers without leading zeros.
      // Valid: "0", "1", "12", "123"
      // Invalid: "01", "1.5", "-1", " 1", "1 ", "1a"
      if (!isValidArrayIndex(segment)) {
        throw new JsonPointerError(
          `Invalid array index '${segment}': must be non-negative integer without leading zeros`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }

      const index = parseInt(segment, 10);

      if (index >= current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds (array length: ${current.length})`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }

      current = current[index];
    } else if (isRecord(current)) {
      // Object property
      if (!hasOwn(current, segment)) {
        throw new JsonPointerError(
          `Property '${segment}' not found in object`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = current[segment];
    } else {
      throw new JsonPointerError(
        `Cannot resolve pointer at segment '${segment}': current value is not an object or array`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }
  }

  return current;
}

/**
 * Check if a JSON Pointer exists in a document
 */
export function exists(document: unknown, pointer: string): boolean {
  try {
    resolve(document, pointer);
    return true;
  } catch (error) {
    if (error instanceof JsonPointerError) {
      return false;
    }
    throw error;
  }
}

/**
 * Set a value at a JSON Pointer location (mutates the document).
 * Accepts both bare RFC 6901 pointers ("/foo/bar") and
 * URI fragment pointers ("#/foo/bar").
 */
export function set(
  document: unknown,
  pointer: string,
  value: unknown,
): void {
  const bare = toBarePointer(pointer);
  const segments = parsePointer(bare);

  if (segments.length === 0) {
    throw new JsonPointerError(
      "Cannot set root document with empty pointer",
      pointer,
    );
  }

  let current = document;
  const lastSegment = segments[segments.length - 1];
  if (lastSegment === undefined) {
    throw new JsonPointerError(
      "Invalid pointer: empty segments array",
      pointer,
    );
  }

  // Check if document is null/undefined for any non-empty path
  if ((document === null || document === undefined) && segments.length > 0) {
    throw new JsonPointerError(
      "Cannot set value: path is null/undefined",
      pointer,
    );
  }

  // Navigate to parent
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment === undefined) {
      throw new JsonPointerError(
        `Invalid pointer: undefined segment at index ${i}`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }

    if (current === null || current === undefined) {
      throw new JsonPointerError(
        `Cannot set value: path is null/undefined at segment '${segment}'`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }

    if (Array.isArray(current)) {
      if (!isValidArrayIndex(segment)) {
        throw new JsonPointerError(
          `Invalid array index '${segment}': must be non-negative integer without leading zeros`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      const index = parseInt(segment, 10);
      if (index >= current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds (array length: ${current.length})`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = current[index];
    } else if (isRecord(current)) {
      if (!hasOwn(current, segment)) {
        throw new JsonPointerError(
          `Property '${segment}' not found in object`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = current[segment];
    } else {
      throw new JsonPointerError(
        `Cannot set value: current value is not an object or array at segment '${segment}'`,
        formatPointer(segments.slice(0, i + 1)),
      );
    }
  }

  // Set the final value
  if (Array.isArray(current)) {
    if (lastSegment === "-") {
      // Special case: append to array
      current.push(value);
    } else {
      if (!isValidArrayIndex(lastSegment)) {
        throw new JsonPointerError(
          `Invalid array index '${lastSegment}': must be non-negative integer without leading zeros`,
          pointer,
        );
      }
      const index = parseInt(lastSegment, 10);
      if (index > current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds for assignment (array length: ${current.length})`,
          pointer,
        );
      }
      current[index] = value;
    }
  } else if (isRecord(current)) {
    current[lastSegment] = value;
  } else {
    throw new JsonPointerError(
      `Cannot set value: parent is not an object or array`,
      pointer,
    );
  }
}

/**
 * Get all JSON Pointers that exist in a document
 *
 * Handles circular references by tracking visited objects to prevent
 * infinite recursion and stack overflow.
 */
export function listPointers(document: unknown, prefix = ""): string[] {
  const pointers: string[] = [];
  const visited = new WeakSet<object>();

  function traverse(obj: unknown, path: string[]) {
    const currentPointer = formatPointer(path);
    pointers.push(currentPointer);

    if (Array.isArray(obj)) {
      // Check for circular reference
      if (visited.has(obj)) {
        return;
      }
      visited.add(obj);

      obj.forEach((_, index) => {
        traverse(obj[index], [...path, index.toString()]);
      });
    } else if (isRecord(obj)) {
      // Check for circular reference
      if (visited.has(obj)) {
        return;
      }
      visited.add(obj);

      Object.keys(obj).forEach((key) => {
        traverse(obj[key], [...path, key]);
      });
    }
  }

  const prefixSegments = prefix ? parsePointer(prefix) : [];
  if (prefix && !exists(document, prefix)) {
    return [];
  }

  const startValue = prefix ? resolve(document, prefix) : document;
  traverse(startValue, prefixSegments);

  return pointers;
}
