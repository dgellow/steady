/**
 * Path Matching Utilities
 *
 * Provides OpenAPI-style path pattern matching with parameter extraction.
 * Used by the mock server for routing and available for testing.
 */

/** Segment types in a compiled path pattern */
export type PathSegment =
  | { type: "literal"; value: string }
  | { type: "param"; name: string }
  | { type: "mixed"; prefix: string; paramName: string; suffix: string };

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
 * compilePathPattern("/form-v{version}/users") // => { segments: [mixed, literal], ... }
 */
export function compilePathPattern(pattern: string): CompiledPathPattern {
  const segments = pattern
    .split("/")
    .filter((s) => s.length > 0)
    .map((segment): PathSegment => {
      // Full parameter: entire segment is {paramName}
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return { type: "param", name: segment.slice(1, -1) };
      }

      // Check for embedded parameter: prefix{paramName}suffix
      // Only match the FIRST parameter in the segment
      const paramMatch = segment.match(/^([^{]*)\{([^}]+)\}(.*)$/);
      if (
        paramMatch && paramMatch[1] !== undefined &&
        paramMatch[2] !== undefined && paramMatch[3] !== undefined
      ) {
        const prefix = paramMatch[1];
        const paramName = paramMatch[2];
        const suffix = paramMatch[3];
        return { type: "mixed", prefix, paramName, suffix };
      }

      // Plain literal segment
      return { type: "literal", value: segment };
    });

  return {
    pattern,
    segments,
    segmentCount: segments.length,
  };
}

/**
 * Split a path into its non-empty segments. Patterns and request paths are
 * split the same way, so "/users/" and "/users" have the same segments.
 */
export function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/**
 * Whether a request segment fits a `prefix{param}suffix` pattern segment
 * with a non-empty value between prefix and suffix.
 */
export function fitsMixedSegment(
  requestSegment: string,
  prefix: string,
  suffix: string,
): boolean {
  return requestSegment.startsWith(prefix) &&
    requestSegment.endsWith(suffix) &&
    prefix.length < requestSegment.length - suffix.length;
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
  return matchPathSegments(splitPath(path), compiled);
}

/**
 * Match the segments of a request path (see `splitPath`) against a compiled
 * path pattern. For matching one path against many patterns: split once.
 *
 * @returns Extracted path parameters if matched, null if no match
 */
export function matchPathSegments(
  requestSegments: readonly string[],
  compiled: CompiledPathPattern,
): Record<string, string> | null {
  // Quick check: segment count must match
  if (requestSegments.length !== compiled.segmentCount) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < compiled.segments.length; i++) {
    const compiledSeg = compiled.segments[i];
    const requestSeg = requestSegments[i];

    // Both should be defined due to length checks, but verify for safety
    if (compiledSeg === undefined || requestSeg === undefined) {
      return null;
    }

    if (compiledSeg.type === "param") {
      // Parameter segment - extract the value
      try {
        params[compiledSeg.name] = decodeURIComponent(requestSeg);
      } catch {
        // Invalid percent encoding - treat as no match
        return null;
      }
    } else if (compiledSeg.type === "mixed") {
      // Mixed segment: prefix{param}suffix
      const { prefix, paramName, suffix } = compiledSeg;
      if (!fitsMixedSegment(requestSeg, prefix, suffix)) {
        return null;
      }

      const rawValue = requestSeg.slice(
        prefix.length,
        requestSeg.length - suffix.length,
      );

      try {
        params[paramName] = decodeURIComponent(rawValue);
      } catch {
        // Invalid percent encoding - treat as no match
        return null;
      }
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
