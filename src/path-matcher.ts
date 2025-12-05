/**
 * Path Matching Utilities
 *
 * Provides OpenAPI-style path pattern matching with parameter extraction.
 * Used by the mock server for routing and available for testing.
 */

/** Segment types in a compiled path pattern */
export type PathSegment =
  | { type: "literal"; value: string }
  | { type: "param"; name: string };

/** Compiled path pattern for efficient matching */
export interface CompiledPathPattern {
  pattern: string;
  segments: PathSegment[];
  segmentCount: number;
}

/**
 * Compile an OpenAPI path pattern into segments for efficient matching.
 *
 * @example
 * compilePathPattern("/users/{id}") // => { segments: [literal, param], ... }
 * compilePathPattern("/api/v1/items") // => { segments: [literal, literal, literal], ... }
 */
export function compilePathPattern(pattern: string): CompiledPathPattern {
  const segments = pattern
    .split("/")
    .filter((s) => s.length > 0)
    .map((segment): PathSegment => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return { type: "param", name: segment.slice(1, -1) };
      }
      return { type: "literal", value: segment };
    });

  return {
    pattern,
    segments,
    segmentCount: segments.length,
  };
}

/**
 * Match a request path against a compiled path pattern.
 *
 * @returns Extracted path parameters if matched, null if no match
 *
 * @example
 * const compiled = compilePathPattern("/users/{id}");
 * matchCompiledPath("/users/123", compiled) // => { id: "123" }
 * matchCompiledPath("/users/123/posts", compiled) // => null (different segment count)
 * matchCompiledPath("/items/123", compiled) // => null (literal mismatch)
 */
export function matchCompiledPath(
  path: string,
  compiled: CompiledPathPattern,
): Record<string, string> | null {
  const requestSegments = path.split("/").filter((s) => s.length > 0);

  // Quick check: segment count must match
  if (requestSegments.length !== compiled.segmentCount) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < compiled.segments.length; i++) {
    const compiledSeg = compiled.segments[i]!;
    const requestSeg = requestSegments[i];

    if (requestSeg === undefined) {
      return null;
    }

    if (compiledSeg.type === "param") {
      // Parameter segment - extract the value
      params[compiledSeg.name] = decodeURIComponent(requestSeg);
    } else if (compiledSeg.value !== requestSeg) {
      // Literal segment must match exactly
      return null;
    }
  }

  return params;
}

/**
 * Match a request path against an OpenAPI path pattern.
 *
 * This is a convenience function that compiles and matches in one step.
 * For repeated matching against the same pattern, use compilePathPattern()
 * and matchCompiledPath() for better performance.
 *
 * @returns Extracted path parameters if matched, null if no match
 *
 * @example
 * matchPathPattern("/users/123", "/users/{id}") // => { id: "123" }
 * matchPathPattern("/api/v1/dashboard/abc-123", "/api/v1/dashboard/{dashboard_id}")
 *   // => { dashboard_id: "abc-123" }
 */
export function matchPathPattern(
  path: string,
  pattern: string,
): Record<string, string> | null {
  const compiled = compilePathPattern(pattern);
  return matchCompiledPath(path, compiled);
}
