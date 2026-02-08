/**
 * Tree-returning JSON Schema validator for the diagnostics engine.
 *
 * Validates data against a JSON Schema and returns a ValidationNode tree
 * preserving composition structure (oneOf/anyOf/allOf) while flattening
 * applicator keywords (properties/items).
 *
 * Three kinds of nodes in the output:
 *   1. Composition: oneOf, anyOf, allOf — have keyword + children
 *   2. Container: root, variant wrappers — have children, no keyword
 *   3. Leaf: keyword failures — no children
 *
 * Applicator keywords (properties, items, patternProperties) are
 * transparent — their child errors surface as leaves with full dotted
 * paths (e.g., "body.address.city").
 */

import type { Schema } from "./types.ts";

// ── Output types ───────────────────────────────────────────────────
// These are structurally compatible with src/engine/types.ts ValidationNode.
// A compile-time test verifies compatibility.

interface ValidationNode {
  keyword?: string;
  path: string;
  schemaPath: string;
  valid: boolean;

  // Leaf details
  message?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;

  // Tree structure
  children?: ValidationNode[];
  variantIndex?: number;
}

// ── Type guards ──────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard for Schema. Since all Schema fields are optional,
 * any plain object from parsed JSON structurally satisfies Schema.
 */
function isSchemaLike(value: unknown): value is Schema {
  return isPlainObject(value);
}

// ── Options ──────────────────────────────────────────────────────

interface TreeValidatorOptions {
  /**
   * External $ref resolver for references the validator can't resolve
   * locally (e.g., "#/components/schemas/Account" needs the full spec).
   *
   * Called with the $ref string. Return Schema if resolved, undefined
   * to fall back to local resolution within the schema.
   */
  resolveRef?: (ref: string) => Schema | undefined;
}

// ── Validator ──────────────────────────────────────────────────────

export class TreeValidator {
  private readonly externalResolver?: (ref: string) => Schema | undefined;

  constructor(options?: TreeValidatorOptions) {
    this.externalResolver = options?.resolveRef;
  }

  /**
   * Validate data against a schema, returning a validation tree.
   *
   * @param data - The value to validate
   * @param schema - The resolved JSON Schema
   * @param schemaPath - JSON pointer to the schema (e.g., "#/paths/.../schema")
   * @param dataPath - Location prefix for paths (e.g., "body")
   */
  validate(
    data: unknown,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
  ): ValidationNode {
    const errors: ValidationNode[] = [];

    this.validateSchema(data, schema, schemaPath, dataPath, errors, schema);

    if (errors.length === 0) {
      return { valid: true, path: dataPath, schemaPath };
    }

    return {
      valid: false,
      path: dataPath,
      schemaPath,
      children: errors,
    };
  }

  /**
   * Core recursive validation. Collects error nodes into `errors`.
   * `rootSchema` is the top-level schema for $ref resolution.
   */
  private validateSchema(
    data: unknown,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
  ): void {
    // Boolean schema
    if (typeof schema === "boolean") {
      // Not supported in our Schema type but handle gracefully
      return;
    }

    // $ref — resolve and validate transparently
    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref, rootSchema);
      if (resolved !== undefined) {
        const refSchemaPath = schema.$ref.startsWith("#")
          ? schema.$ref
          : schemaPath;
        this.validateSchema(data, resolved, refSchemaPath, dataPath, errors, rootSchema);
      }
      return;
    }

    // Composition keywords — create tree nodes
    if (schema.oneOf) {
      this.validateOneOf(data, schema.oneOf, schemaPath, dataPath, errors, rootSchema);
    }
    if (schema.anyOf) {
      this.validateAnyOf(data, schema.anyOf, schemaPath, dataPath, errors, rootSchema);
    }
    if (schema.allOf) {
      this.validateAllOf(data, schema.allOf, schemaPath, dataPath, errors, rootSchema);
    }

    // type
    if (schema.type !== undefined) {
      this.validateType(data, schema, schemaPath, dataPath, errors);
    }

    // enum
    if (schema.enum !== undefined) {
      this.validateEnum(data, schema.enum, schemaPath, dataPath, errors);
    }

    // const
    if (schema.const !== undefined) {
      this.validateConst(data, schema.const, schemaPath, dataPath, errors);
    }

    // Object validation
    if (isPlainObject(data)) {
      const obj = data;

      if (schema.required) {
        this.validateRequired(obj, schema.required, schemaPath, dataPath, errors);
      }

      // properties (applicator — flattened)
      const evaluatedProps = new Set<string>();
      if (schema.properties) {
        this.validateProperties(
          obj, schema.properties, schemaPath, dataPath, errors, rootSchema, evaluatedProps,
        );
      }

      // patternProperties
      if (schema.patternProperties) {
        this.validatePatternProperties(
          obj, schema.patternProperties, schemaPath, dataPath, errors, rootSchema, evaluatedProps,
        );
      }

      // additionalProperties
      if (schema.additionalProperties !== undefined) {
        this.validateAdditionalProperties(
          obj, schema, schemaPath, dataPath, errors, rootSchema, evaluatedProps,
        );
      }

      // minProperties / maxProperties
      if (schema.minProperties !== undefined && Object.keys(obj).length < schema.minProperties) {
        errors.push({
          valid: false, keyword: "minProperties", path: dataPath, schemaPath,
          expected: schema.minProperties, actual: Object.keys(obj).length,
        });
      }
      if (schema.maxProperties !== undefined && Object.keys(obj).length > schema.maxProperties) {
        errors.push({
          valid: false, keyword: "maxProperties", path: dataPath, schemaPath,
          expected: schema.maxProperties, actual: Object.keys(obj).length,
        });
      }
    }

    // String validation
    if (typeof data === "string") {
      this.validateString(data, schema, schemaPath, dataPath, errors);
    }

    // Numeric validation
    if (typeof data === "number") {
      this.validateNumber(data, schema, schemaPath, dataPath, errors);
    }

    // Array validation
    if (Array.isArray(data)) {
      this.validateArray(data, schema, schemaPath, dataPath, errors, rootSchema);
    }
  }

  // ── Type validation ──────────────────────────────────────────────

  private validateType(
    data: unknown,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    const actualType = getJsonType(data);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];

    // OpenAPI 3.0 nullable support
    if (schema.nullable === true && data === null) return;

    const matches = types.some((t) => {
      if (t === actualType) return true;
      // "integer" also accepts numbers that are integers
      if (t === "integer" && actualType === "number" && Number.isInteger(data)) return true;
      return false;
    });

    if (!matches) {
      errors.push({
        valid: false,
        keyword: "type",
        path: dataPath,
        schemaPath,
        expected: Array.isArray(schema.type) ? schema.type : schema.type,
        actual: data === null ? null : actualType,
      });
    }
  }

  // ── Required validation ──────────────────────────────────────────

  private validateRequired(
    obj: Record<string, unknown>,
    required: string[],
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    for (const field of required) {
      if (!(field in obj)) {
        errors.push({
          valid: false,
          keyword: "required",
          path: dataPath,
          schemaPath: `${schemaPath}`,
          field,
        });
      }
    }
  }

  // ── Properties (applicator — flattened) ──────────────────────────

  private validateProperties(
    obj: Record<string, unknown>,
    properties: Record<string, Schema>,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
    evaluatedProps: Set<string>,
  ): void {
    for (const [propName, propSchema] of Object.entries(properties)) {
      evaluatedProps.add(propName);
      if (propName in obj) {
        this.validateSchema(
          obj[propName],
          propSchema,
          `${schemaPath}/properties/${escapeJsonPointer(propName)}`,
          `${dataPath}.${propName}`,
          errors,
          rootSchema,
        );
      }
    }
  }

  // ── Pattern Properties ───────────────────────────────────────────

  private validatePatternProperties(
    obj: Record<string, unknown>,
    patternProperties: Record<string, Schema>,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
    evaluatedProps: Set<string>,
  ): void {
    for (const [pattern, propSchema] of Object.entries(patternProperties)) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        continue;
      }

      for (const propName of Object.keys(obj)) {
        if (regex.test(propName)) {
          evaluatedProps.add(propName);
          this.validateSchema(
            obj[propName],
            propSchema,
            `${schemaPath}/patternProperties/${escapeJsonPointer(pattern)}`,
            `${dataPath}.${propName}`,
            errors,
            rootSchema,
          );
        }
      }
    }
  }

  // ── Additional Properties ────────────────────────────────────────

  private validateAdditionalProperties(
    obj: Record<string, unknown>,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
    evaluatedProps: Set<string>,
  ): void {
    for (const propName of Object.keys(obj)) {
      if (evaluatedProps.has(propName)) continue;

      if (schema.additionalProperties === false) {
        errors.push({
          valid: false,
          keyword: "additionalProperties",
          path: dataPath,
          schemaPath,
          field: propName,
        });
      } else if (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties !== null
      ) {
        this.validateSchema(
          obj[propName],
          schema.additionalProperties,
          `${schemaPath}/additionalProperties`,
          `${dataPath}.${propName}`,
          errors,
          rootSchema,
        );
      }
    }
  }

  // ── Enum / Const ─────────────────────────────────────────────────

  private validateEnum(
    data: unknown,
    enumValues: unknown[],
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    if (!enumValues.some((v) => deepEqual(v, data))) {
      errors.push({
        valid: false,
        keyword: "enum",
        path: dataPath,
        schemaPath,
        expected: enumValues,
        actual: data,
      });
    }
  }

  private validateConst(
    data: unknown,
    constValue: unknown,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    if (!deepEqual(data, constValue)) {
      errors.push({
        valid: false,
        keyword: "const",
        path: dataPath,
        schemaPath,
        expected: constValue,
        actual: data,
      });
    }
  }

  // ── String validation ────────────────────────────────────────────

  private validateString(
    data: string,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        valid: false, keyword: "minLength", path: dataPath, schemaPath,
        expected: schema.minLength, actual: data.length,
      });
    }

    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        valid: false, keyword: "maxLength", path: dataPath, schemaPath,
        expected: schema.maxLength, actual: data.length,
      });
    }

    if (schema.pattern !== undefined) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push({
            valid: false, keyword: "pattern", path: dataPath, schemaPath,
            expected: schema.pattern, actual: data,
          });
        }
      } catch {
        // Invalid regex — skip validation
      }
    }

    if (schema.format !== undefined) {
      if (!validateFormat(data, schema.format)) {
        errors.push({
          valid: false, keyword: "format", path: dataPath, schemaPath,
          expected: schema.format, actual: data,
        });
      }
    }
  }

  // ── Numeric validation ───────────────────────────────────────────

  private validateNumber(
    data: number,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
  ): void {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        valid: false, keyword: "minimum", path: dataPath, schemaPath,
        expected: schema.minimum, actual: data,
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        valid: false, keyword: "maximum", path: dataPath, schemaPath,
        expected: schema.maximum, actual: data,
      });
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      errors.push({
        valid: false, keyword: "exclusiveMinimum", path: dataPath, schemaPath,
        expected: schema.exclusiveMinimum, actual: data,
      });
    }
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      errors.push({
        valid: false, keyword: "exclusiveMaximum", path: dataPath, schemaPath,
        expected: schema.exclusiveMaximum, actual: data,
      });
    }
    if (schema.multipleOf !== undefined && data % schema.multipleOf !== 0) {
      errors.push({
        valid: false, keyword: "multipleOf", path: dataPath, schemaPath,
        expected: schema.multipleOf, actual: data,
      });
    }
  }

  // ── Array validation ─────────────────────────────────────────────

  private validateArray(
    data: unknown[],
    schema: Schema,
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
  ): void {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        valid: false, keyword: "minItems", path: dataPath, schemaPath,
        expected: schema.minItems, actual: data.length,
      });
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        valid: false, keyword: "maxItems", path: dataPath, schemaPath,
        expected: schema.maxItems, actual: data.length,
      });
    }

    // items — validate each element (flattened, indexed paths)
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      for (let i = 0; i < data.length; i++) {
        this.validateSchema(
          data[i],
          schema.items,
          `${schemaPath}/items`,
          `${dataPath}.${i}`,
          errors,
          rootSchema,
        );
      }
    }

    // prefixItems — validate positional items
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
        const itemSchema = schema.prefixItems[i];
        if (itemSchema) {
          this.validateSchema(
            data[i],
            itemSchema,
            `${schemaPath}/prefixItems/${i}`,
            `${dataPath}.${i}`,
            errors,
            rootSchema,
          );
        }
      }
    }

    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i++) {
        const key = JSON.stringify(data[i]);
        if (seen.has(key)) {
          errors.push({
            valid: false, keyword: "uniqueItems", path: dataPath, schemaPath,
            message: `Duplicate item at index ${i}`,
          });
          break;
        }
        seen.add(key);
      }
    }
  }

  // ── Composition ──────────────────────────────────────────────────

  private validateOneOf(
    data: unknown,
    variants: Schema[],
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
  ): void {
    const variantResults: ValidationNode[] = [];

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (!variant) continue;

      const variantErrors: ValidationNode[] = [];
      this.validateSchema(
        data, variant, `${schemaPath}/oneOf/${i}`, dataPath, variantErrors, rootSchema,
      );

      const valid = variantErrors.length === 0;
      const variantNode: ValidationNode = {
        valid,
        path: dataPath,
        schemaPath: `${schemaPath}/oneOf/${i}`,
        variantIndex: i,
        children: variantErrors.length > 0 ? variantErrors : undefined,
      };
      variantResults.push(variantNode);
    }

    const matchCount = variantResults.filter((v) => v.valid).length;

    // Exactly one match → valid (standard oneOf)
    if (matchCount === 1) return;

    // Zero or multiple matches → composition failure
    errors.push({
      valid: false,
      keyword: "oneOf",
      path: dataPath,
      schemaPath: `${schemaPath}/oneOf`,
      children: variantResults,
    });
  }

  private validateAnyOf(
    data: unknown,
    variants: Schema[],
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
  ): void {
    const variantResults: ValidationNode[] = [];

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (!variant) continue;

      const variantErrors: ValidationNode[] = [];
      this.validateSchema(
        data, variant, `${schemaPath}/anyOf/${i}`, dataPath, variantErrors, rootSchema,
      );

      const valid = variantErrors.length === 0;
      variantResults.push({
        valid,
        path: dataPath,
        schemaPath: `${schemaPath}/anyOf/${i}`,
        variantIndex: i,
        children: variantErrors.length > 0 ? variantErrors : undefined,
      });
    }

    const hasMatch = variantResults.some((v) => v.valid);

    if (hasMatch) return;

    errors.push({
      valid: false,
      keyword: "anyOf",
      path: dataPath,
      schemaPath: `${schemaPath}/anyOf`,
      children: variantResults,
    });
  }

  private validateAllOf(
    data: unknown,
    subschemas: Schema[],
    schemaPath: string,
    dataPath: string,
    errors: ValidationNode[],
    rootSchema: Schema,
  ): void {
    const childResults: ValidationNode[] = [];
    let allValid = true;

    for (let i = 0; i < subschemas.length; i++) {
      const sub = subschemas[i];
      if (!sub) continue;

      const subErrors: ValidationNode[] = [];
      this.validateSchema(
        data, sub, `${schemaPath}/allOf/${i}`, dataPath, subErrors, rootSchema,
      );

      const valid = subErrors.length === 0;
      if (!valid) allValid = false;

      childResults.push({
        valid,
        path: dataPath,
        schemaPath: `${schemaPath}/allOf/${i}`,
        children: subErrors.length > 0 ? subErrors : undefined,
      });
    }

    if (allValid) return;

    errors.push({
      valid: false,
      keyword: "allOf",
      path: dataPath,
      schemaPath: `${schemaPath}/allOf`,
      children: childResults,
    });
  }

  // ── $ref resolution ──────────────────────────────────────────────

  private resolveRef(ref: string, rootSchema: Schema): Schema | undefined {
    // Try local resolution first (for in-schema refs like #/$defs/X)
    const local = this.resolveRefLocally(ref, rootSchema);
    if (local !== undefined) return local;

    // Fall back to external resolver (for document-level refs like #/components/schemas/X)
    if (this.externalResolver) {
      return this.externalResolver(ref);
    }

    return undefined;
  }

  /**
   * Resolve a $ref by navigating within the given rootSchema.
   * Returns undefined if the ref can't be resolved locally.
   */
  private resolveRefLocally(ref: string, rootSchema: Schema): Schema | undefined {
    if (!ref.startsWith("#/")) return undefined;

    const pointer = ref.slice(1); // Strip "#"
    const segments = pointer.split("/").slice(1); // Split and drop empty first

    let current: unknown = rootSchema;
    for (const segment of segments) {
      const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!isPlainObject(current)) return undefined;
      current = current[unescaped];
    }

    if (isSchemaLike(current)) {
      return current;
    }
    return undefined;
  }
}

// ── Utilities ──────────────────────────────────────────────────────

function getJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }

  return false;
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Basic format validation. Returns true if the value passes.
 * Only validates formats where validation is unambiguous.
 */
function validateFormat(value: string, format: string): boolean {
  switch (format) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "uri":
    case "uri-reference":
      try {
        new URL(value, "http://example.com");
        return true;
      } catch {
        return false;
      }
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    case "date-time":
      return !isNaN(Date.parse(value)) && /T/.test(value);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "ipv4":
      return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
    case "ipv6":
      return value.includes(":");
    default:
      // Unknown format — pass (conservative)
      return true;
  }
}
