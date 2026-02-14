/**
 * Shared parameter format parsing logic
 *
 * Used by both query parameter validation and form data parsing.
 * Handles array and object serialization formats per OpenAPI spec.
 */

import type { QueryArrayFormat, QueryObjectFormat } from "./types.ts";

// Re-export types for convenience
export type { QueryArrayFormat, QueryObjectFormat };

/**
 * Concrete format types (excludes 'auto')
 */
export type ConcreteArrayFormat = Exclude<QueryArrayFormat, "auto">;
export type ConcreteObjectFormat = Exclude<QueryObjectFormat, "auto">;

/**
 * Interface for key-value pair sources (URLSearchParams, FormData entries, etc.)
 */
export interface KeyValueSource {
  entries(): Iterable<[string, string]>;
  get(key: string): string | null;
  getAll(key: string): string[];
}

/**
 * Wrap URLSearchParams to implement KeyValueSource
 */
export function wrapURLSearchParams(params: URLSearchParams): KeyValueSource {
  return {
    entries: () => params.entries(),
    get: (key) => params.get(key),
    getAll: (key) => params.getAll(key),
  };
}

/**
 * Wrap a Map<string, string[]> to implement KeyValueSource
 */
export function wrapStringMap(map: Map<string, string[]>): KeyValueSource {
  return {
    entries: function* () {
      for (const [key, values] of map) {
        for (const value of values) {
          yield [key, value] as [string, string];
        }
      }
    },
    get: (key) => map.get(key)?.[0] ?? null,
    getAll: (key) => map.get(key) ?? [],
  };
}

// =============================================================================
// Format Resolution (auto -> concrete)
// =============================================================================

/**
 * Resolve array format from 'auto' to concrete format based on parameter spec.
 * When format is 'auto', reads from OpenAPI style/explode properties.
 */
export function resolveArrayFormat(
  format: QueryArrayFormat,
  style?: string,
  explode?: boolean,
): ConcreteArrayFormat {
  if (format !== "auto") {
    return format;
  }

  const s = style ?? "form";
  const e = explode ?? (s === "form");

  switch (s) {
    case "form":
      return e ? "repeat" : "comma";
    case "spaceDelimited":
      return "space";
    case "pipeDelimited":
      return "pipe";
    default:
      return "repeat";
  }
}

/**
 * Resolve object format from 'auto' to concrete format based on OpenAPI
 * style/explode. When format is not 'auto', returns it directly.
 */
export function resolveObjectFormat(
  format: QueryObjectFormat,
  style?: string,
  explode?: boolean,
): ConcreteObjectFormat {
  if (format !== "auto") {
    return format;
  }

  const s = style ?? "form";
  const e = explode ?? (s === "form");

  switch (s) {
    case "form":
      return e ? "flat" : "flat-comma";
    case "deepObject":
      return "brackets";
    default:
      return "flat";
  }
}

// =============================================================================
// Array Parsing
// =============================================================================

/**
 * Get array values from key-value source based on format.
 *
 * @param source - Key-value pair source
 * @param name - Parameter name
 * @param format - Array serialization format (must be concrete, not 'auto')
 * @returns Array of string values
 */
export function getArrayValues(
  source: KeyValueSource,
  name: string,
  format: ConcreteArrayFormat,
): string[] {
  switch (format) {
    case "repeat":
      // colors=red&colors=green
      return source.getAll(name);
    case "comma": {
      // colors=red,green,blue
      const value = source.get(name);
      return value ? value.split(",") : [];
    }
    case "space": {
      // colors=red%20green%20blue
      const value = source.get(name);
      return value ? value.split(" ") : [];
    }
    case "pipe": {
      // colors=red|green|blue
      const value = source.get(name);
      return value ? value.split("|") : [];
    }
    case "brackets": {
      // colors[]=red&colors[]=green
      return source.getAll(`${name}[]`);
    }
  }
}

/**
 * Check if a parameter has a value in the source.
 */
export function hasParamValue(
  source: KeyValueSource,
  name: string,
  isArray: boolean,
  isObject: boolean,
  arrayFormat: ConcreteArrayFormat,
  objectFormat: ConcreteObjectFormat,
): boolean {
  if (isObject) {
    switch (objectFormat) {
      case "flat":
        return source.get(name) !== null;
      case "flat-comma": {
        const value = source.get(name);
        return value !== null && value.includes(",");
      }
      case "brackets": {
        const prefix = `${name}[`;
        for (const [key] of source.entries()) {
          if (key.startsWith(prefix)) return true;
        }
        return false;
      }
      case "dots": {
        const prefix = `${name}.`;
        for (const [key] of source.entries()) {
          if (key.startsWith(prefix)) return true;
        }
        return false;
      }
    }
  }

  if (isArray) {
    return getArrayValues(source, name, arrayFormat).length > 0;
  }

  return source.get(name) !== null;
}

// =============================================================================
// Object Parsing
// =============================================================================

/**
 * Parse bracket notation path: filter[meta][level] -> ["meta", "level"]
 */
export function parseBracketPath(key: string, baseName: string): string[] {
  const path: string[] = [];
  const prefix = `${baseName}[`;

  if (!key.startsWith(prefix)) return path;

  const rest = key.slice(baseName.length);
  const bracketRegex = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(rest)) !== null) {
    const segment = match[1];
    if (segment !== undefined) {
      path.push(segment);
    }
  }

  return path;
}

/**
 * Set a value at a nested path in an object.
 * Creates intermediate objects/arrays as needed.
 *
 * Safe from prototype pollution when obj is created with Object.create(null).
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) return;

  let current: Record<string, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const nextSegment = path[i + 1];

    if (segment === undefined || nextSegment === undefined) continue;

    if (!(segment in current)) {
      current[segment] = isNumericString(nextSegment)
        ? []
        : Object.create(null);
    }

    const next = current[segment];
    if (typeof next !== "object" || next === null) {
      current[segment] = isNumericString(nextSegment)
        ? []
        : Object.create(null);
    }

    current = current[segment] as Record<string, unknown>;
  }

  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
}

/**
 * Check if a string is a numeric index (for array detection)
 */
export function isNumericString(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Parse object parameter from key-value source based on format.
 * Returns a nested object structure.
 *
 * Note: This is the basic parsing without schema-based type coercion.
 * The caller should apply type coercion based on schema if needed.
 *
 * @param source - Key-value pair source
 * @param name - Parameter name (base name for nested formats)
 * @param format - Object serialization format (must be concrete, not 'auto')
 * @returns Parsed object
 */
export function parseObjectValue(
  source: KeyValueSource,
  name: string,
  format: ConcreteObjectFormat,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);

  switch (format) {
    case "flat": {
      // In flat format, we can't know which top-level params belong to this object
      // without schema info. Return the single value if present.
      const value = source.get(name);
      if (value !== null) {
        result[name] = value;
      }
      return result;
    }

    case "flat-comma": {
      // id=role,admin,firstName,Alex -> {role: "admin", firstName: "Alex"}
      const value = source.get(name);
      if (!value) return result;

      const parts = value.split(",");
      for (let i = 0; i < parts.length - 1; i += 2) {
        const key = parts[i];
        const val = parts[i + 1];
        if (key !== undefined && val !== undefined) {
          result[key] = val;
        }
      }
      return result;
    }

    case "brackets": {
      // id[role]=admin&id[firstName]=Alex -> {role: "admin", firstName: "Alex"}
      const prefix = `${name}[`;

      for (const [key, value] of source.entries()) {
        if (key.startsWith(prefix)) {
          const path = parseBracketPath(key, name);
          if (path.length > 0) {
            setNestedValue(result, path, value);
          }
        }
      }
      return result;
    }

    case "dots": {
      // id.role=admin&id.firstName=Alex -> {role: "admin", firstName: "Alex"}
      const prefix = `${name}.`;

      for (const [key, value] of source.entries()) {
        if (key.startsWith(prefix)) {
          const path = key.slice(prefix.length).split(".");
          if (path.length > 0) {
            setNestedValue(result, path, value);
          }
        }
      }
      return result;
    }
  }
}

// =============================================================================
// Key Path Parsing
// =============================================================================

/**
 * Parse a key into path segments based on object format.
 *
 * @param key - The key to parse (e.g., "user[address][city]" or "user.address.city")
 * @param format - Object serialization format
 * @returns Array of path segments
 *
 * Examples:
 * - parseKeyToPath("user", "flat") → ["user"]
 * - parseKeyToPath("user[address][city]", "brackets") → ["user", "address", "city"]
 * - parseKeyToPath("user.address.city", "dots") → ["user", "address", "city"]
 * - parseKeyToPath("items[0]", "brackets") → ["items", "0"]
 */
export function parseKeyToPath(
  key: string,
  format: ConcreteObjectFormat,
): string[] {
  switch (format) {
    case "flat":
    case "flat-comma":
      // No nesting - key is used as-is
      return [key];

    case "brackets": {
      // Parse bracket notation: user[address][city] → ["user", "address", "city"]
      const result: string[] = [];

      // Match: base name, then any number of [segment] parts
      const match = key.match(/^([^\[]+)(.*)$/);
      if (!match || match[1] === undefined) return [key];

      result.push(match[1]);

      // Extract all bracketed segments
      const brackets = match[2] ?? "";
      const bracketRegex = /\[([^\]]*)\]/g;
      let bracketMatch: RegExpExecArray | null;

      while ((bracketMatch = bracketRegex.exec(brackets)) !== null) {
        const segment = bracketMatch[1];
        if (segment !== undefined) {
          result.push(segment);
        }
      }

      return result;
    }

    case "dots":
      // Split by dots: user.address.city → ["user", "address", "city"]
      return key.split(".");
  }
}

// =============================================================================
// Form Data Helpers
// =============================================================================

/**
 * Group form data entries by field name, handling array format normalization.
 *
 * For brackets format, strips [] suffix and tracks explicit array fields.
 *
 * @param entries - Iterable of [key, value] pairs
 * @param arrayFormat - Array serialization format
 * @returns Object with grouped values and explicit array field names
 */
export function groupFormEntries(
  entries: Iterable<[string, string]>,
  arrayFormat: ConcreteArrayFormat,
): {
  groups: Map<string, string[]>;
  explicitArrays: Set<string>;
} {
  const groups = new Map<string, string[]>();
  const explicitArrays = new Set<string>();

  for (const [rawKey, value] of entries) {
    let key = rawKey;

    // Normalize array notation
    if (arrayFormat === "brackets" && rawKey.endsWith("[]")) {
      key = rawKey.slice(0, -2);
      explicitArrays.add(key);
    }

    const existing = groups.get(key) || [];
    existing.push(value);
    groups.set(key, existing);
  }

  return { groups, explicitArrays };
}
