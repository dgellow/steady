/**
 * Recursive interpreter. Transforms a validation tree into diagnostics.
 *
 * Walks the validation tree bottom-up:
 * - Leaves: classify keyword, build Diagnostic
 * - Containers (no composition keyword): merge children's results
 * - Composition (oneOf/anyOf/allOf): delegate to composition handler
 *
 * The interpreter threads `spec` (for schema resolution) and `data` (the
 * request value being validated) through unchanged. Schema context and
 * data are resolved on-demand at composition and leaf nodes.
 */

import type { DiagnosticLocation } from "../diagnostic.ts";
import type {
  CompositionContext,
  InterpretResult,
  SpecResolver,
  ValidationNode,
} from "./types.ts";
import { isStructural } from "./structural.ts";
import { attributeLeaf, type LeafNode } from "./leaf-attribution.ts";
import { attributeOneOf } from "./composition/one-of.ts";
import { attributeAnyOf } from "./composition/any-of.ts";
import { attributeAllOf } from "./composition/all-of.ts";

const COMPOSITION_KEYWORDS = new Set(["oneOf", "anyOf", "allOf"]);

/**
 * Interpret a validation tree into diagnostics.
 *
 * @param node - Root of the validation tree from the schema validator
 * @param spec - Resolver for looking up schemas by pointer
 * @param location - Where in the request this validation applies
 * @param data - The request data being validated
 */
export function interpret(
  node: ValidationNode,
  spec: SpecResolver,
  location: DiagnosticLocation,
  data: unknown,
): InterpretResult {
  // Valid node, nothing to report
  if (node.valid) {
    return {
      diagnostics: [],
      structurallyValid: true,
      structuralFailureCount: 0,
    };
  }

  // Node with children, recurse
  if (node.children && node.children.length > 0) {
    const childResults = node.children.map((child) =>
      interpret(child, spec, location, data)
    );

    // Composition keyword → delegate to handler
    if (node.keyword && COMPOSITION_KEYWORDS.has(node.keyword)) {
      const schema = spec.resolve(node.schemaPath);
      const nodeData = resolveDataAtPath(data, node.path, location);
      const context: CompositionContext = {
        path: node.path,
        schemaPath: node.schemaPath,
        schema,
        data: nodeData,
      };

      switch (node.keyword) {
        case "oneOf":
          return attributeOneOf(childResults, context);
        case "anyOf":
          return attributeAnyOf(childResults, context);
        case "allOf":
          return attributeAllOf(childResults, context);
      }
    }

    // Container node (root, variant wrapper). Merge children
    return {
      diagnostics: childResults.flatMap((c) => c.diagnostics),
      structurallyValid: childResults.every((c) => c.structurallyValid),
      structuralFailureCount: childResults.reduce(
        (sum, c) => sum + c.structuralFailureCount,
        0,
      ),
    };
  }

  // Leaf error, attribute and classify
  return interpretLeaf(node, spec, location);
}

/**
 * Interpret a leaf validation error.
 */
function interpretLeaf(
  node: ValidationNode,
  spec: SpecResolver,
  location: DiagnosticLocation,
): InterpretResult {
  // A leaf without a keyword is unexpected. Treat as structurally invalid
  // with no diagnostic rather than silently ignoring
  if (!node.keyword) {
    return {
      diagnostics: [],
      structurallyValid: false,
      structuralFailureCount: 0,
    };
  }

  const schema = spec.resolve(node.schemaPath);
  const leafNode: LeafNode = { ...node, keyword: node.keyword };
  const diagnostic = attributeLeaf(leafNode, schema, location);
  const structural = isStructural(node.keyword, schema);

  return {
    diagnostics: [diagnostic],
    structurallyValid: !structural,
    structuralFailureCount: structural ? 1 : 0,
  };
}

/**
 * Navigate request data to the value at a given path.
 *
 * Paths are dot-separated (e.g., "body.payment.type"). The first segment
 * is the location prefix (e.g., "body") and is skipped when navigating
 * into the data object.
 *
 * Returns the data at that path, or undefined if navigation fails.
 */
export function resolveDataAtPath(
  data: unknown,
  path: string,
  location: DiagnosticLocation,
): unknown {
  // Strip the location prefix (e.g., "body.payment" → "payment")
  // Path always starts with location in practice (e.g., "body.payment" for location "body")
  const prefix = location + ".";
  let relativePath: string;
  if (path === location) {
    relativePath = "";
  } else if (path.startsWith(prefix)) {
    relativePath = path.slice(prefix.length);
  } else {
    // Path doesn't match location, return full data as fallback
    return data;
  }

  if (relativePath === "") {
    return data;
  }

  const segments = relativePath.split(".");
  let current: unknown = data;

  for (const segment of segments) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
