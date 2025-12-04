/**
 * Reference resolution utilities for OpenAPI specs
 */

import { exists, JsonPointerError, resolve } from "./json-pointer.ts";

export interface ReferenceContext {
  document: unknown;
  visited: Set<string>;
  path: string[];
}

/**
 * Resolve an OpenAPI reference object
 *
 * Handles URI fragment percent-encoding per RFC 3986.
 * When JSON Pointers are used as URI fragments (e.g., #/paths/~1users~1%7Bid%7D),
 * they may be percent-encoded. We decode before applying JSON Pointer resolution.
 */
export function resolveReference(
  document: unknown,
  ref: string,
  context?: ReferenceContext,
): unknown {
  // For now, only handle internal references (JSON Pointers)
  if (!ref.startsWith("#/") && ref !== "#") {
    throw new JsonPointerError(
      "External references not supported yet",
      ref,
    );
  }

  // Remove "#" and percent-decode the URI fragment
  // Per RFC 3986, URI fragments may be percent-encoded
  const pointer = decodeURIComponent(ref.slice(1));

  if (!exists(document, pointer)) {
    throw new JsonPointerError(
      `Reference ${ref} not found in document`,
      pointer,
    );
  }

  // Check for circular references if context provided
  if (context) {
    if (context.visited.has(ref)) {
      throw new JsonPointerError(
        `Circular reference detected: ${
          [...context.visited, ref].join(" -> ")
        }`,
        pointer,
      );
    }

    const newContext: ReferenceContext = {
      ...context,
      visited: new Set([...context.visited, ref]),
      path: [...context.path, ref],
    };

    // If the resolved value contains more references, resolve them too
    const resolved = resolve(document, pointer);
    return resolveNestedReferences(resolved, document, newContext);
  }

  return resolve(document, pointer);
}

/**
 * Recursively resolve references in a resolved object
 */
function resolveNestedReferences(
  obj: unknown,
  document: unknown,
  context: ReferenceContext,
): unknown {
  if (typeof obj === "object" && obj !== null) {
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        resolveNestedReferences(item, document, context)
      );
    }

    const record = obj as Record<string, unknown>;

    // If this object has a $ref, resolve it
    if ("$ref" in record && typeof record.$ref === "string") {
      return resolveReference(document, record.$ref, context);
    }

    // Otherwise, recursively process all properties
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = resolveNestedReferences(value, document, {
        ...context,
        path: [...context.path, key],
      });
    }
    return result;
  }

  return obj;
}

/**
 * Find all circular references in a document
 */
export function findCircularReferences(document: unknown): string[] {
  const circularRefs: string[] = [];
  const visited = new Set<string>();

  function checkReferences(obj: unknown, path: string[] = []) {
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          checkReferences(item, [...path, index.toString()]);
        });
      } else {
        const record = obj as Record<string, unknown>;

        if ("$ref" in record && typeof record.$ref === "string") {
          const ref = record.$ref;
          if (ref.startsWith("#/")) {
            try {
              resolveReference(document, ref, {
                document,
                visited,
                path,
              });
            } catch (error) {
              if (
                error instanceof JsonPointerError &&
                error.message.includes("Circular reference")
              ) {
                circularRefs.push(ref);
              }
            }
          }
        } else {
          // Recursively check nested objects
          Object.entries(record).forEach(([key, value]) => {
            checkReferences(value, [...path, key]);
          });
        }
      }
    }
  }

  checkReferences(document);
  return circularRefs;
}

/**
 * Check if a reference exists and can be resolved
 */
export function isValidReference(document: unknown, ref: string): boolean {
  try {
    resolveReference(document, ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all references in a document
 */
export function getAllReferences(document: unknown): string[] {
  const refs: string[] = [];

  function findRefs(obj: unknown) {
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach(findRefs);
      } else {
        const record = obj as Record<string, unknown>;
        if ("$ref" in record && typeof record.$ref === "string") {
          refs.push(record.$ref);
        }
        Object.values(record).forEach(findRefs);
      }
    }
  }

  findRefs(document);
  return refs;
}
