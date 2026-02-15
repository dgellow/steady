/**
 * Leaf attribution. Maps a leaf validation error to an E-code.
 *
 * Given (keyword, location, schema context), determines which E-code to assign.
 * Some keywords have a single E-code regardless of context. Others depend on
 * location (body vs query vs header), schema values (format), or the data
 * itself (null for non-nullable).
 */

import type { Schema } from "@steady/json-schema";
import type {
  Diagnostic,
  DiagnosticDisplay,
  DiagnosticLocation,
} from "../diagnostic.ts";
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
    case "minProperties":
    case "maxProperties":
    case "uniqueItems":
      return "E4002";

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

  const display = buildDisplay(node, schema);

  const diag: Diagnostic = {
    code,
    severity: definition.severity,
    category: definition.category,
    requestPath: node.path.join("."),
    specPointer: node.schemaPath,
    message: node.message ?? buildMessage(node, definition.title),
    expected: node.expected,
    actual: node.actual,
    attribution: {
      confidence: leafConfidence(code),
      reasoning: buildReasoning(node, schema, code),
    },
  };

  if (display) {
    diag.display = display;
  }

  return diag;
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

// ── Display context ────────────────────────────────────────────────────

/**
 * Build compiler-style display context for high-value keywords.
 * Returns undefined for keywords where display context adds no value.
 */
function buildDisplay(
  node: LeafNode,
  schema: Schema,
): DiagnosticDisplay | undefined {
  switch (node.keyword) {
    case "type": {
      const typeStr = formatSchemaType(schema);
      const isArray = Array.isArray(schema.type);
      // type: "string" or type: [string, null]
      const text = isArray ? `type: [${typeStr}]` : `type: "${typeStr}"`;
      const start = 7; // after 'type: "' or 'type: ['
      return {
        context: [{
          text,
          highlight: {
            start,
            end: start + typeStr.length,
            label: "Expected type",
          },
        }],
      };
    }
    case "required": {
      if (!node.field || !Array.isArray(schema.required)) return undefined;
      const reqStr = JSON.stringify(schema.required);
      const text = `required: ${reqStr}`;
      // Find the field name in the array string to highlight it
      const fieldStr = JSON.stringify(node.field);
      const fieldIndex = reqStr.indexOf(fieldStr);
      if (fieldIndex === -1) return undefined;
      const start = "required: ".length + fieldIndex;
      return {
        context: [{
          text,
          highlight: {
            start,
            end: start + fieldStr.length,
            label: "Missing from request",
          },
        }],
      };
    }
    case "additionalProperties": {
      if (schema.additionalProperties === false) {
        const text = "additionalProperties: false";
        return {
          context: [{
            text,
            highlight: {
              start: "additionalProperties: ".length,
              end: "additionalProperties: false".length,
              label: node.field
                ? `Unknown property '${node.field}' not allowed`
                : "No additional properties allowed",
            },
          }],
        };
      }
      return undefined;
    }
    case "enum": {
      if (!Array.isArray(schema.enum)) return undefined;
      const MAX_ENUM_DISPLAY_LEN = 80;
      const enumStr = JSON.stringify(schema.enum);
      const truncated = enumStr.length > MAX_ENUM_DISPLAY_LEN
        ? enumStr.slice(0, MAX_ENUM_DISPLAY_LEN - 3) + "..."
        : enumStr;
      const text = `enum: ${truncated}`;
      return {
        context: [{
          text,
          highlight: {
            start: 0,
            end: text.length,
            label: node.actual !== undefined
              ? `Value ${JSON.stringify(node.actual)} not in allowed list`
              : "Value not in allowed list",
          },
        }],
      };
    }
    case "const": {
      if (schema.const === undefined) return undefined;
      const constStr = JSON.stringify(schema.const);
      const text = `const: ${constStr}`;
      return {
        context: [{
          text,
          highlight: {
            start: "const: ".length,
            end: text.length,
            label: "Expected constant value",
          },
        }],
      };
    }
    default:
      return undefined;
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

// ── Reasoning chain builders ──────────────────────────────────────

/**
 * Build a multi-entry reasoning chain for a leaf diagnostic.
 *
 * Three layers:
 * 1. Classification: what decision was made and why (from the code)
 * 2. Constraint: what the spec requires (from schema context)
 * 3. Violation: what the request sent (from node data)
 */
function buildReasoning(
  node: LeafNode,
  schema: Schema,
  code: ECode,
): string[] {
  const reasoning: string[] = [];

  reasoning.push(classifyReason(node, code));

  const constraint = describeConstraint(node, schema, code);
  if (constraint) reasoning.push(constraint);

  const violation = describeViolation(node, schema, code);
  if (violation) reasoning.push(violation);

  return reasoning;
}

/**
 * Classification reason: explains the decision that led to this code.
 */
function classifyReason(node: LeafNode, code: ECode): string {
  const pathStr = node.path.join(".");
  const location = node.path[0] ?? "body";

  switch (code) {
    case "E5001":
      return `Field ${pathStr} received null but schema does not allow nullable`;
    case "E3010":
      return `Array item type mismatch at ${pathStr}`;
    case "E3001":
    case "E3003":
    case "E3008":
      return `Type mismatch in ${location} at ${pathStr}`;
    case "E3002":
      return `Missing required query parameter at ${pathStr}`;
    case "E3004":
      return `Missing required header at ${pathStr}`;
    case "E3007":
      return `Missing required field in ${location} at ${pathStr}`;
    case "E3009":
      return `Unknown property not allowed at ${pathStr}`;
    case "E5003":
      return `Unknown property at ${pathStr}, spec does not declare additionalProperties`;
    case "E3016":
      return `Enum value mismatch at ${pathStr}`;
    case "E3017":
      return `Constant value mismatch at ${pathStr}`;
    case "E3018":
      return `Structural format mismatch at ${pathStr}`;
    case "E4001":
      return `Content format mismatch at ${pathStr}`;
    case "E4002":
      return classifyE4002(node);
    case "E4003":
      return `String length violation at ${pathStr}`;
    case "E4004":
      return `Numeric range violation at ${pathStr}`;
    case "E4005":
      return `Array size violation at ${pathStr}`;
    case "E4007":
      return `Multiple-of constraint violation at ${pathStr}`;
    default:
      return `${getCode(code).title} at ${pathStr}`;
  }
}

/**
 * E4002 is a catch-all content-note. Use keyword for accurate classification.
 */
function classifyE4002(node: LeafNode): string {
  const pathStr = node.path.join(".");
  switch (node.keyword) {
    case "minProperties":
    case "maxProperties":
      return `Object property count violation at ${pathStr}`;
    case "uniqueItems":
      return `Unique items constraint violation at ${pathStr}`;
    default:
      return `Pattern mismatch at ${pathStr}`;
  }
}

/**
 * Constraint context: what the spec requires.
 */
function describeConstraint(
  node: LeafNode,
  schema: Schema,
  code: ECode,
): string | undefined {
  switch (node.keyword) {
    case "type": {
      if (code === "E5001") {
        const typeStr = formatSchemaType(schema);
        return `Schema type is "${typeStr}" with no nullable declaration`;
      }
      if (schema.type !== undefined) {
        return `Schema requires type "${formatSchemaType(schema)}"`;
      }
      return undefined;
    }
    case "required": {
      if (node.field) {
        return `Field '${node.field}' is in the schema's required array`;
      }
      return undefined;
    }
    case "additionalProperties": {
      if (schema.additionalProperties === false) {
        return "Schema sets additionalProperties: false";
      }
      return "Schema does not declare additionalProperties";
    }
    case "enum":
      return schema.enum
        ? `Allowed values: ${JSON.stringify(schema.enum)}`
        : undefined;
    case "const":
      return schema.const !== undefined
        ? `Schema requires constant value ${JSON.stringify(schema.const)}`
        : undefined;
    case "format":
      return schema.format
        ? `Schema requires format "${schema.format}"`
        : undefined;
    case "pattern":
      return schema.pattern
        ? `Schema requires pattern /${schema.pattern}/`
        : undefined;
    case "minLength":
      return schema.minLength !== undefined
        ? `Schema requires minLength: ${schema.minLength}`
        : undefined;
    case "maxLength":
      return schema.maxLength !== undefined
        ? `Schema requires maxLength: ${schema.maxLength}`
        : undefined;
    case "minimum":
      return schema.minimum !== undefined
        ? `Schema requires minimum: ${schema.minimum}`
        : undefined;
    case "maximum":
      return schema.maximum !== undefined
        ? `Schema requires maximum: ${schema.maximum}`
        : undefined;
    case "exclusiveMinimum":
      return schema.exclusiveMinimum !== undefined
        ? `Schema requires exclusiveMinimum: ${schema.exclusiveMinimum}`
        : undefined;
    case "exclusiveMaximum":
      return schema.exclusiveMaximum !== undefined
        ? `Schema requires exclusiveMaximum: ${schema.exclusiveMaximum}`
        : undefined;
    case "minItems":
      return schema.minItems !== undefined
        ? `Schema requires minItems: ${schema.minItems}`
        : undefined;
    case "maxItems":
      return schema.maxItems !== undefined
        ? `Schema requires maxItems: ${schema.maxItems}`
        : undefined;
    case "multipleOf":
      return schema.multipleOf !== undefined
        ? `Schema requires multipleOf: ${schema.multipleOf}`
        : undefined;
    case "minProperties":
      return schema.minProperties !== undefined
        ? `Schema requires minProperties: ${schema.minProperties}`
        : undefined;
    case "maxProperties":
      return schema.maxProperties !== undefined
        ? `Schema requires maxProperties: ${schema.maxProperties}`
        : undefined;
    case "uniqueItems":
      return schema.uniqueItems === true
        ? "Schema requires uniqueItems: true"
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Violation context: what the request sent.
 */
function describeViolation(
  node: LeafNode,
  _schema: Schema,
  code: ECode,
): string | undefined {
  switch (node.keyword) {
    case "type": {
      if (code === "E5001") {
        return "Could be: SDK sends null when field should be omitted, or spec is missing nullable: true";
      }
      if (node.actual !== undefined) {
        return `Request sent ${String(node.actual)}`;
      }
      return undefined;
    }
    case "required": {
      if (node.field) {
        const location = node.path[0] ?? "body";
        return `Request ${location} did not include '${node.field}'`;
      }
      return undefined;
    }
    case "additionalProperties": {
      if (node.field) {
        return `Request included unknown property '${node.field}'`;
      }
      return undefined;
    }
    case "enum":
    case "const":
    case "format":
    case "pattern":
      return node.actual !== undefined
        ? `Request sent ${JSON.stringify(node.actual)}`
        : undefined;
    case "minLength":
    case "maxLength":
      return node.actual !== undefined
        ? `Actual length: ${node.actual}`
        : undefined;
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
    case "multipleOf":
      return node.actual !== undefined
        ? `Request sent ${node.actual}`
        : undefined;
    case "minItems":
    case "maxItems":
      return node.actual !== undefined
        ? `Request array has ${node.actual} items`
        : undefined;
    case "minProperties":
    case "maxProperties":
      return node.actual !== undefined
        ? `Request object has ${node.actual} properties`
        : undefined;
    case "uniqueItems":
      return "Request array contains duplicate items";
    default:
      return undefined;
  }
}

function formatSchemaType(schema: Schema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.join(", ");
  }
  return String(schema.type ?? "unspecified");
}

/**
 * Leaf confidence based on E-code category.
 *
 * Three tiers:
 * - 1.0: Factual observations (type mismatch, missing field, etc.)
 * - 0.8: High confidence but known false-positive source (E3009).
 *   additionalProperties violations are often caused by serialization
 *   format differences or test data, not actual SDK bugs.
 * - 0.5: Genuinely ambiguous (E5xxx category)
 *
 * Composition handlers and re-attribution logic may assign different
 * confidence values based on context (e.g., discriminator match = 0.95,
 * optional parent re-attribution = 0.6).
 */
function leafConfidence(code: ECode): number {
  if (code === "E3009") return 0.8;
  return getCode(code).category === "ambiguous" ? 0.5 : 1.0;
}
