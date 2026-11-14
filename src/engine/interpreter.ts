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

import { isPlainObject } from "@steady/json-pointer";
import type { DiagnosticLocation } from "../diagnostic.ts";
import type {
  CompositionContext,
  InterpretResult,
  SpecResolver,
  ValidationNode,
} from "./types.ts";
import { isStructural } from "./structural.ts";
import type { Diagnostic } from "../diagnostic.ts";
import { getCode } from "../codes/registry.ts";
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
      const nodeData = resolveDataAtPath(data, node.path);
      const context: CompositionContext = {
        path: node.path,
        schemaPath: node.schemaPath,
        schema,
        data: nodeData,
      };

      // The variants of a composition apply to the same value as the
      // composition. No variant of a oneOf or anyOf accepts the value's
      // type: neither does the composition. One member of an allOf does
      // not: neither does the allOf.
      switch (node.keyword) {
        case "oneOf":
          return withWrongType(
            attributeOneOf(childResults, context),
            childResults.every((c) => c.wrongType === true),
          );
        case "anyOf":
          return withWrongType(
            attributeAnyOf(childResults, context),
            childResults.every((c) => c.wrongType === true),
          );
        case "allOf":
          return withWrongType(
            attributeAllOf(childResults, context),
            childResults.some((c) => c.wrongType === true),
          );
      }
    }

    // Container node (root, variant wrapper). Merge children. A child
    // speaks about the container's own value when it has the same path.
    const depth = node.path.length;
    return withWrongType(
      {
        diagnostics: childResults.flatMap((c) => c.diagnostics),
        structurallyValid: childResults.every((c) => c.structurallyValid),
        structuralFailureCount: childResults.reduce(
          (sum, c) => sum + c.structuralFailureCount,
          0,
        ),
      },
      node.children.some((child, index) =>
        child.path.length === depth && childResults[index]?.wrongType === true
      ),
    );
  }

  // Leaf error, attribute and classify
  return interpretLeaf(node, spec, location);
}

function withWrongType(
  result: InterpretResult,
  wrongType: boolean,
): InterpretResult {
  if (!wrongType) return result;
  return { ...result, wrongType: true };
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
  let diagnostic = attributeLeaf(leafNode, schema, location);
  const structural = isStructural(node.keyword, schema);

  // E3013: the object with the missing field is the value of a property
  // that the request did not have to send.
  if (
    diagnostic.code === "E3007" && location === "body" &&
    node.optionalProperty !== undefined && node.field !== undefined
  ) {
    diagnostic = inOptionalParent(
      diagnostic,
      node.field,
      node.optionalProperty,
    );
  }

  return withWrongType(
    {
      diagnostics: [diagnostic],
      structurallyValid: !structural,
      structuralFailureCount: structural ? 1 : 0,
    },
    node.keyword === "type",
  );
}

/**
 * Re-attribute a missing required field (E3007) to E3013: its object is
 * the value of the optional property `parent`.
 */
function inOptionalParent(
  diagnostic: Diagnostic,
  field: string,
  parent: string,
): Diagnostic {
  const e3013 = getCode("E3013");
  return {
    ...diagnostic,
    code: "E3013",
    severity: e3013.severity,
    category: e3013.category,
    attribution: {
      confidence: 0.6,
      reasoning: [
        `Parent object '${parent}' is optional in the schema`,
        `Required field '${field}' is inside optional parent '${parent}'`,
        // Keep constraint and violation entries (skip stale classification at index 0)
        ...diagnostic.attribution.reasoning.slice(1),
      ],
    },
  };
}

/**
 * Navigate request data to the value at a given path.
 *
 * Paths are string arrays (e.g., ["body", "payment", "type"]). The first
 * segment is the location prefix (e.g., "body") and is skipped when
 * navigating into the data object.
 *
 * Returns the data at that path, or undefined if navigation fails.
 */
export function resolveDataAtPath(
  data: unknown,
  path: string[],
): unknown {
  // Skip the first segment (location prefix like "body", "query", etc.)
  const segments = path.slice(1);

  if (segments.length === 0) {
    return data;
  }

  let current: unknown = data;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }

  return current;
}
