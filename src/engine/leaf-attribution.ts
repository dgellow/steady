/**
 * Leaf attribution. Maps a leaf validation error to an E-code.
 *
 * Given (keyword, location, schema context), determines which E-code to assign.
 * Some keywords have a single E-code regardless of context. Others depend on
 * location (body vs query vs header), schema values (format), or the data
 * itself (null for non-nullable).
 */

import type { Schema } from "@steady/json-schema";
import type { Diagnostic, DiagnosticLocation } from "../diagnostic.ts";
import type { ValidationNode } from "./types.ts";
import { type ECode, getCode } from "../codes/registry.ts";
import { STRUCTURAL_FORMATS } from "./structural.ts";

/** A ValidationNode with keyword guaranteed present (leaf nodes). */
export type LeafNode = ValidationNode & { keyword: string };

/**
 * Determine the E-code for a leaf validation error.
 *
 * @param node - The leaf validation node
 * @param schema - The resolved schema for this node
 * @param location - Where in the request this error occurred
 * @returns The E-code string (e.g., "E3007")
 */
export function attributeLeafCode(
  node: LeafNode,
  schema: Schema,
  location: DiagnosticLocation,
): ECode {
  switch (node.keyword) {
    // ── type ─────────────────────────────────────────────────────────
    case "type": {
      // Null for non-nullable: ambiguous (E5001)
      if (node.actual === null && !isNullable(schema)) {
        return "E5001";
      }
      if (node.arrayItem) {
        return "E3010";
      }
      return typeCodeForLocation(location);
    }

    // ── required ─────────────────────────────────────────────────────
    case "required":
      return requiredCodeForLocation(location);

    // ── additionalProperties ─────────────────────────────────────────
    case "additionalProperties":
      if (schema.additionalProperties === false) {
        return "E3009";
      }
      return "E5003";

    // ── enum / const ─────────────────────────────────────────────────
    // Spec silent
    case "enum":
      return "E3016";
    case "const":
      return "E3017";

    // ── format ───────────────────────────────────────────────────────
    case "format": {
      const format = schema.format;
      if (typeof format === "string" && STRUCTURAL_FORMATS.has(format)) {
        return "E3018";
      }
      return "E4001";
    }

    // ── Content keywords ─────────────────────────────────────────────
    case "pattern":
      return "E4002";
    case "minLength":
    case "maxLength":
      return "E4003";
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return "E4004";
    case "minItems":
    case "maxItems":
      return "E4005";
    case "multipleOf":
      return "E4007";

    default:
      // Unknown keyword, content-note is the conservative default
      return "E4002";
  }
}

/**
 * Build a full Diagnostic from a leaf node.
 */
export function attributeLeaf(
  node: LeafNode,
  schema: Schema,
  location: DiagnosticLocation,
): Diagnostic {
  const code = attributeLeafCode(node, schema, location);
  const definition = getCode(code);

  return {
    code,
    severity: definition.severity,
    category: definition.category,
    requestPath: node.path,
    specPointer: node.schemaPath,
    message: node.message ?? buildMessage(node, definition.title),
    expected: node.expected,
    actual: node.actual,
    attribution: {
      confidence: defaultConfidence(code),
      reasoning: [`${definition.title} at ${node.path}`],
    },
  };
}

/**
 * Build a human-readable message from leaf node details.
 * Falls back to the generic title if no specific details are available.
 */
function buildMessage(node: LeafNode, fallback: string): string {
  switch (node.keyword) {
    case "required":
      return node.field ? `Missing required property: ${node.field}` : fallback;
    case "type":
      return node.expected !== undefined && node.actual !== undefined
        ? `Expected type ${String(node.expected)}, got ${String(node.actual)}`
        : fallback;
    case "enum":
      return node.actual !== undefined
        ? `Value ${JSON.stringify(node.actual)} is not in allowed values`
        : fallback;
    case "const":
      return node.expected !== undefined
        ? `Expected constant value ${JSON.stringify(node.expected)}`
        : fallback;
    case "additionalProperties":
      return node.field ? `Unknown property: ${node.field}` : fallback;
    default:
      return fallback;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function typeCodeForLocation(location: DiagnosticLocation): ECode {
  switch (location) {
    case "path":
      return "E3001";
    case "query":
      return "E3003";
    default:
      return "E3008"; // body, header, cookie, or unknown
  }
}

function requiredCodeForLocation(location: DiagnosticLocation): ECode {
  switch (location) {
    case "query":
      return "E3002";
    case "header":
      return "E3004";
    default:
      return "E3007"; // body, path, cookie
  }
}

function isNullable(schema: Schema): boolean {
  if (schema.nullable === true) {
    return true;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.includes("null");
  }
  return schema.type === "null";
}

/**
 * Default confidence based on E-code category.
 * The engine may adjust this based on composition context.
 */
function defaultConfidence(code: ECode): number {
  const prefix = code.charAt(1);
  switch (prefix) {
    case "1": // Spec issues, high confidence in attribution
      return 0.9;
    case "2": // Routing, high confidence
      return 0.9;
    case "3": // Transport, high confidence (SDK's job)
      return 0.9;
    case "4": // Content, high confidence (not SDK's job)
      return 0.9;
    case "5": // Ambiguous, lower confidence
      return 0.5;
    default:
      return 0.5;
  }
}
