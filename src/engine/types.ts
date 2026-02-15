/**
 * Shared types for the diagnostics engine.
 *
 * These live in a separate file to avoid circular dependencies between
 * the interpreter and composition handlers.
 */

import type { Schema } from "@steady/json-schema";
import type { Diagnostic } from "../diagnostic.ts";

// ValidationNode is the canonical type from TreeValidator.
// Re-exported here so engine consumers import from one place.
export type {
  ValidationNode,
} from "../../packages/json-schema/tree-validator.ts";

/** Result of interpreting a node. Contains diagnostics plus structural validity. */
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
  /** Node's request path segments (e.g., ["body"] or ["body", "payment"]). */
  path: string[];
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
