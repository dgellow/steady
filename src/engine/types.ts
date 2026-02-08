/**
 * Shared types for the diagnostics engine.
 *
 * These live in a separate file to avoid circular dependencies between
 * the interpreter and composition handlers.
 */

import type { Schema } from "@steady/json-schema";
import type { Diagnostic } from "../diagnostic.ts";

/**
 * A node in the validation tree produced by the schema validator.
 *
 * Three kinds of nodes:
 * 1. Composition: oneOf, anyOf, allOf — have children, trigger composition logic
 * 2. Container: root, variant wrapper — have children, merge results
 * 3. Leaf: keyword failure — no children
 *
 * Applicator keywords (properties, items, patternProperties) are flattened
 * by the validator — they don't appear as nodes. The `path` field carries
 * nesting context (e.g., "body.address.street").
 */
export interface ValidationNode {
  /** The JSON Schema keyword that failed. Absent on container nodes. */
  keyword?: string;
  /** Where in the request this error occurred (e.g., "body.email"). */
  path: string;
  /** JSON pointer into the spec — used to resolve schema context. */
  schemaPath: string;
  valid: boolean;

  // Leaf details
  message?: string;
  /** Keyword-specific detail (e.g., field name for "required"). */
  field?: string;
  expected?: unknown;
  actual?: unknown;

  // Tree structure
  children?: ValidationNode[];
  /** Present on oneOf/anyOf variant wrapper nodes. */
  variantIndex?: number;
}

/** Result of interpreting a node — diagnostics plus structural validity. */
export interface InterpretResult {
  diagnostics: Diagnostic[];
  /**
   * Whether the subtree structurally matches.
   * Determined by keyword type at leaves, propagated upward by composition logic.
   */
  structurallyValid: boolean;
  /**
   * How many individual structural failures occurred in this subtree.
   * At a leaf: isStructural ? 1 : 0.
   * At a container: sum of children.
   * Used by variant identification to pick the closest variant when none match.
   */
  structuralFailureCount: number;
}

/**
 * Context passed to composition handlers.
 *
 * Gives handlers everything they need: schema for pitfall detection,
 * request data for discriminator/property overlap, and path info for
 * diagnostic locations.
 */
export interface CompositionContext {
  /** Node's request path (e.g., "body" or "body.payment"). */
  path: string;
  /** Node's spec pointer (e.g., "#/.../oneOf"). */
  schemaPath: string;
  /** Resolved schema for the composition node. */
  schema: Schema;
  /** Request data at this path (for discriminator, property overlap). */
  data: unknown;
}

/**
 * Resolves schema pointers against the full OpenAPI spec.
 *
 * The interpreter passes through the spec unchanged. Schema context is
 * resolved via `node.schemaPath` only where needed: at leaf nodes (for
 * isStructural and attributeLeaf) and at composition nodes (for discriminator
 * metadata, sibling schema access, etc.).
 */
export interface SpecResolver {
  resolve(schemaPath: string): Schema;
}
