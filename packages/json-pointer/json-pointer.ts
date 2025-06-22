/**
 * JSON Pointer implementation following RFC 6901
 * https://tools.ietf.org/html/rfc6901
 */

export class JsonPointerError extends Error {
  constructor(message: string, public pointer: string) {
    super(message);
    this.name = "JsonPointerError";
  }
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
 */
export function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Convert an array of path segments to a JSON Pointer string
 */
export function formatPointer(segments: string[]): string {
  if (segments.length === 0) {
    return "";
  }
  return "/" + segments.map(escapeSegment).join("/");
}

/**
 * Resolve a JSON Pointer against a document
 */
export function resolve(document: unknown, pointer: string): unknown {
  const segments = parsePointer(pointer);
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

      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0 || !Number.isInteger(index)) {
        throw new JsonPointerError(
          `Invalid array index '${segment}': must be non-negative integer`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }

      if (index >= current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds (array length: ${current.length})`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }

      current = current[index];
    } else if (typeof current === "object") {
      // Object property
      const obj = current as Record<string, unknown>;
      if (!(segment in obj)) {
        throw new JsonPointerError(
          `Property '${segment}' not found in object`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = obj[segment];
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
 * Set a value at a JSON Pointer location (mutates the document)
 */
export function set(
  document: unknown,
  pointer: string,
  value: unknown,
): void {
  const segments = parsePointer(pointer);

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
      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0 || !Number.isInteger(index)) {
        throw new JsonPointerError(
          `Invalid array index '${segment}': must be non-negative integer`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      if (index >= current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds (array length: ${current.length})`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = current[index];
    } else if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(segment in obj)) {
        throw new JsonPointerError(
          `Property '${segment}' not found in object`,
          formatPointer(segments.slice(0, i + 1)),
        );
      }
      current = obj[segment];
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
      const index = parseInt(lastSegment, 10);
      if (isNaN(index) || index < 0 || !Number.isInteger(index)) {
        throw new JsonPointerError(
          `Invalid array index '${lastSegment}': must be non-negative integer`,
          pointer,
        );
      }
      if (index > current.length) {
        throw new JsonPointerError(
          `Array index ${index} out of bounds for assignment (array length: ${current.length})`,
          pointer,
        );
      }
      current[index] = value;
    }
  } else if (typeof current === "object" && current !== null) {
    (current as Record<string, unknown>)[lastSegment] = value;
  } else {
    throw new JsonPointerError(
      `Cannot set value: parent is not an object or array`,
      pointer,
    );
  }
}

/**
 * Get all JSON Pointers that exist in a document
 */
export function listPointers(document: unknown, prefix = ""): string[] {
  const pointers: string[] = [];

  function traverse(obj: unknown, path: string[]) {
    const currentPointer = formatPointer(path);
    pointers.push(currentPointer);

    if (Array.isArray(obj)) {
      obj.forEach((_, index) => {
        traverse(obj[index], [...path, index.toString()]);
      });
    } else if (typeof obj === "object" && obj !== null) {
      const record = obj as Record<string, unknown>;
      Object.keys(record).forEach((key) => {
        traverse(record[key], [...path, key]);
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
