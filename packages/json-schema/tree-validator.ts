/**
 * Tree-returning JSON Schema validator for the diagnostics engine.
 *
 * Validates data against a JSON Schema and returns a ValidationNode tree
 * preserving composition structure (oneOf/anyOf/allOf) while flattening
 * applicator keywords (properties/items).
 *
 * Three kinds of nodes in the output:
 *   1. Composition: oneOf, anyOf, allOf; have keyword + children
 *   2. Container: root, variant wrappers; have children, no keyword
 *   3. Leaf: keyword failures; no children
 *
 * Applicator keywords (properties, items, patternProperties) are
 * transparent; their child errors surface as leaves with full dotted
 * paths (e.g., "body.address.city").
 */

import {
  formatFragmentPointer,
  type FragmentPointer,
  getOwn,
  isFragmentPointer,
  isPlainObject,
  parseFragmentPointer,
  type PointerPath,
} from "@steady/json-pointer";
import { isSchema } from "./types.ts";
import type { Schema } from "./types.ts";
import type { SchemaRegistry } from "./schema-registry.ts";

// ── Output types ───────────────────────────────────────────────────

export interface ValidationNode {
  keyword?: string;
  path: string[];
  schemaPath: FragmentPointer;
  valid: boolean;

  // Leaf details
  message?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;

  /** True when this leaf represents a direct array item error. */
  arrayItem?: boolean;

  // Tree structure
  children?: ValidationNode[];
  variantIndex?: number;
}

// ── Options ──────────────────────────────────────────────────────

interface TreeValidatorOptions {
  /**
   * Schema registry for resolving $refs against the full document.
   * When provided, refs that can't be resolved locally within the
   * schema will be resolved via the registry.
   */
  registry?: SchemaRegistry;

  /**
   * Validation direction for readOnly/writeOnly filtering.
   * - "request": readOnly properties excluded from required checks
   * - "response": writeOnly properties excluded from required checks
   * - undefined: no filtering (all required properties enforced)
   */
  direction?: "request" | "response";
}

/**
 * Levels of nesting in a value that are validated. Validation recurses
 * along the value, so the limit has to stay well below the depth at which
 * the call stack runs out, also for schemas that add several calls per
 * level (a $ref into an allOf into properties). Content nested deeper is
 * not validated; one `depth` node says so. Real payloads nest a few dozen
 * levels.
 */
export const MAX_VALIDATION_DEPTH = 500;

/**
 * Keywords whose value is a regular expression written by the spec author.
 * The validator never compiles or runs them.
 *
 * A regular expression decides how long matching takes: `^(a+)+$` needs
 * exponential time on a string of a few dozen characters, and a mock server
 * must not be stoppable by its spec. The dialect is also not the one many
 * specs are written for, so a mismatch found by the JavaScript engine is
 * not reliable evidence either.
 *
 * - `pattern`: strings are not checked against it.
 * - `patternProperties`: which properties it covers is unknown, so an
 *   object that has it gets no additional-property errors, and the values
 *   of properties not named in `properties` are not validated.
 */
export const REGEX_KEYWORDS = ["pattern", "patternProperties"] as const;

/**
 * Keywords that make the applicable schema depend on the value. The
 * validator does not evaluate them: the schemas inside are parsed and
 * checked for shape, and never applied.
 */
export const CONDITIONAL_KEYWORDS = [
  "if",
  "then",
  "else",
  "dependentSchemas",
] as const;

// ── Validator ──────────────────────────────────────────────────────

export class TreeValidator {
  private readonly registry?: SchemaRegistry;
  private readonly direction?: "request" | "response";

  /**
   * Referenced schemas that are being validated right now, each with the
   * values it is being applied to. See `enterRef`.
   */
  private readonly activeRefs = new Map<
    Schema,
    { data: unknown; depth: number }[]
  >();

  /** Length of the data path at the root of the current `validate` call. */
  private rootDepth = 0;
  /** Whether the current `validate` call has reported the depth limit. */
  private depthReported = false;

  constructor(options?: TreeValidatorOptions) {
    this.registry = options?.registry;
    this.direction = options?.direction;
  }

  /**
   * Validate data against a schema, returning a validation tree.
   *
   * @param data - The value to validate
   * @param schema - JSON Schema object, or a boolean. JSON Schema 2020-12
   *   treats `true` as "accept everything" and `false` as "reject everything".
   * @param schemaPath - JSON pointer to the schema (e.g., "#/paths/.../schema")
   * @param dataPath - Location prefix for paths (e.g., "body")
   */
  validate(
    data: unknown,
    schema: Schema | boolean,
    schemaPath: FragmentPointer,
    dataPath: string[],
  ): ValidationNode {
    const errors: ValidationNode[] = [];
    const path = parseFragmentPointer(schemaPath);

    this.rootDepth = dataPath.length;
    this.depthReported = false;
    try {
      this.validateSchema(data, schema, path, dataPath, errors, schema);
    } finally {
      // Empty after a normal return. An exception can leave entries behind.
      this.activeRefs.clear();
    }

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
   *
   * `schemaPath` is the structured position inside the schema tree. It
   * is a `PointerPath`, not a `FragmentPointer`: new segments are
   * appended via `[...schemaPath, segment]`, and the only time a
   * `FragmentPointer` is produced is when it leaves this module via a
   * `ValidationNode`, at which point we call `formatFragmentPointer`.
   */
  private validateSchema(
    data: unknown,
    schema: Schema | boolean,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    context?: { arrayItem?: boolean },
  ): void {
    if (dataPath.length - this.rootDepth > MAX_VALIDATION_DEPTH) {
      if (!this.depthReported) {
        this.depthReported = true;
        errors.push({
          valid: false,
          keyword: "depth",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          message:
            `Value is nested deeper than ${MAX_VALIDATION_DEPTH} levels. Content below this point was not validated`,
          expected: MAX_VALIDATION_DEPTH,
        });
      }
      return;
    }

    // Boolean schema (JSON Schema 2020-12: false rejects all, true accepts all)
    if (typeof schema === "boolean") {
      if (!schema) {
        errors.push({
          valid: false,
          keyword: "false",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          message: "Schema is false; no value is valid",
        });
      }
      return;
    }

    // $ref: resolve and validate. In JSON Schema 2020-12, sibling keywords
    // alongside $ref are valid and must be applied.
    if (schema.$ref) {
      const target = this.followRef(schema.$ref, rootSchema);
      if (target !== undefined) {
        const refPath: PointerPath = isFragmentPointer(target.ref)
          ? parseFragmentPointer(target.ref)
          : schemaPath;
        if (typeof target.schema === "boolean") {
          this.validateSchema(
            data,
            target.schema,
            refPath,
            dataPath,
            errors,
            rootSchema,
            context,
          );
        } else if (this.enterRef(target.schema, data, dataPath.length)) {
          try {
            this.validateSchema(
              data,
              target.schema,
              refPath,
              dataPath,
              errors,
              rootSchema,
              context,
            );
          } finally {
            this.leaveRef(target.schema);
          }
        }
      }

      // Apply sibling keywords from the $ref-bearing schema.
      // Build a sibling schema with $ref removed, then validate if non-empty.
      const { $ref: _, ...siblings } = schema;
      const siblingKeys = Object.keys(siblings);
      if (siblingKeys.length > 0) {
        this.validateSchema(
          data,
          siblings,
          schemaPath,
          dataPath,
          errors,
          rootSchema,
          context,
        );
      }
      return;
    }

    // Composition keywords, create tree nodes
    if (schema.oneOf) {
      this.validateOneOf(
        data,
        schema.oneOf,
        schemaPath,
        dataPath,
        errors,
        rootSchema,
        context,
      );
    }
    if (schema.anyOf) {
      this.validateAnyOf(
        data,
        schema.anyOf,
        schemaPath,
        dataPath,
        errors,
        rootSchema,
        context,
      );
    }
    if (schema.allOf) {
      this.validateAllOf(
        data,
        schema.allOf,
        schemaPath,
        dataPath,
        errors,
        rootSchema,
        context,
      );
    }

    // not: data must NOT validate against the inner schema.
    // No inner errors means the data matched, so `not` rejects.
    if (schema.not !== undefined) {
      const innerErrors: ValidationNode[] = [];
      this.validateSchema(
        data,
        schema.not,
        [...schemaPath, "not"],
        dataPath,
        innerErrors,
        rootSchema,
        context,
      );
      if (innerErrors.length === 0) {
        errors.push({
          keyword: "not",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          valid: false,
          message: "Value must not match the schema in 'not'",
        });
      }
    }

    // type
    if (schema.type !== undefined) {
      this.validateType(data, schema, schemaPath, dataPath, errors, context);
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
        const required = this.filterRequired(
          schema.required,
          schema.properties,
        );
        if (required.length > 0) {
          this.validateRequired(
            obj,
            required,
            schemaPath,
            dataPath,
            errors,
          );
        }
      }

      // properties (applicator, flattened)
      const evaluatedProps = new Set<string>();
      if (schema.properties) {
        this.validateProperties(
          obj,
          schema.properties,
          schemaPath,
          dataPath,
          errors,
          rootSchema,
          evaluatedProps,
        );
      }

      // patternProperties is not evaluated: see `REGEX_KEYWORDS`. Any
      // property name may match one of its patterns, so no property of
      // this object can be called additional.
      const anyNameMayBeCovered = schema.patternProperties !== undefined &&
        Object.keys(schema.patternProperties).length > 0;

      // additionalProperties
      if (schema.additionalProperties !== undefined && !anyNameMayBeCovered) {
        this.validateAdditionalProperties(
          obj,
          schema,
          schemaPath,
          dataPath,
          errors,
          rootSchema,
          evaluatedProps,
        );
      }

      // minProperties / maxProperties
      if (
        schema.minProperties !== undefined &&
        Object.keys(obj).length < schema.minProperties
      ) {
        errors.push({
          valid: false,
          keyword: "minProperties",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.minProperties,
          actual: Object.keys(obj).length,
        });
      }
      if (
        schema.maxProperties !== undefined &&
        Object.keys(obj).length > schema.maxProperties
      ) {
        errors.push({
          valid: false,
          keyword: "maxProperties",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.maxProperties,
          actual: Object.keys(obj).length,
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
      this.validateArray(
        data,
        schema,
        schemaPath,
        dataPath,
        errors,
        rootSchema,
      );
    }
  }

  // ── Type validation ──────────────────────────────────────────────

  private validateType(
    data: unknown,
    schema: Schema,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    context?: { arrayItem?: boolean },
  ): void {
    const actualType = getJsonType(data);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];

    // OpenAPI 3.0 nullable support
    if (schema.nullable === true && data === null) return;

    const matches = types.some((t) => {
      if (t === actualType) return true;
      // "integer" also accepts numbers that are integers
      if (
        t === "integer" && actualType === "number" && Number.isInteger(data)
      ) return true;
      return false;
    });

    if (!matches) {
      errors.push({
        valid: false,
        keyword: "type",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: Array.isArray(schema.type) ? schema.type : schema.type,
        actual: data === null ? null : actualType,
        arrayItem: context?.arrayItem || undefined,
      });
    }
  }

  // ── Required validation ──────────────────────────────────────────

  /**
   * Filter required fields based on validation direction.
   * In request direction, readOnly properties are excluded.
   * In response direction, writeOnly properties are excluded.
   */
  private filterRequired(
    required: string[],
    properties: Record<string, Schema> | undefined,
  ): string[] {
    if (!this.direction || !properties) return required;

    return required.filter((field) => {
      const propSchema = getOwn(properties, field);
      if (!propSchema || typeof propSchema !== "object") return true;

      if (this.direction === "request" && propSchema.readOnly === true) {
        return false;
      }
      if (this.direction === "response" && propSchema.writeOnly === true) {
        return false;
      }
      return true;
    });
  }

  private validateRequired(
    obj: Record<string, unknown>,
    required: string[],
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
  ): void {
    for (const field of required) {
      if (!Object.hasOwn(obj, field)) {
        errors.push({
          valid: false,
          keyword: "required",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          field,
          expected: field,
        });
      }
    }
  }

  // ── Properties (applicator, flattened) ──────────────────────────

  private validateProperties(
    obj: Record<string, unknown>,
    properties: Record<string, Schema>,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    evaluatedProps: Set<string>,
  ): void {
    for (const [propName, propSchema] of Object.entries(properties)) {
      evaluatedProps.add(propName);
      if (Object.hasOwn(obj, propName)) {
        this.validateSchema(
          obj[propName],
          propSchema,
          [...schemaPath, "properties", propName],
          [...dataPath, propName],
          errors,
          rootSchema,
        );
      }
    }
  }

  // ── Additional Properties ────────────────────────────────────────

  private validateAdditionalProperties(
    obj: Record<string, unknown>,
    schema: Schema,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    evaluatedProps: Set<string>,
  ): void {
    for (const propName of Object.keys(obj)) {
      if (evaluatedProps.has(propName)) continue;

      if (schema.additionalProperties === false) {
        errors.push({
          valid: false,
          keyword: "additionalProperties",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          field: propName,
          expected: false,
        });
      } else if (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties !== null
      ) {
        this.validateSchema(
          obj[propName],
          schema.additionalProperties,
          [...schemaPath, "additionalProperties"],
          [...dataPath, propName],
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
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
  ): void {
    if (!enumValues.some((v) => deepEqual(v, data))) {
      errors.push({
        valid: false,
        keyword: "enum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: enumValues,
        actual: data,
      });
    }
  }

  private validateConst(
    data: unknown,
    constValue: unknown,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
  ): void {
    if (!deepEqual(data, constValue)) {
      errors.push({
        valid: false,
        keyword: "const",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: constValue,
        actual: data,
      });
    }
  }

  // ── String validation ────────────────────────────────────────────

  private validateString(
    data: string,
    schema: Schema,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
  ): void {
    if (schema.minLength !== undefined || schema.maxLength !== undefined) {
      const length = characterCount(data);

      if (schema.minLength !== undefined && length < schema.minLength) {
        errors.push({
          valid: false,
          keyword: "minLength",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.minLength,
          actual: length,
        });
      }

      if (schema.maxLength !== undefined && length > schema.maxLength) {
        errors.push({
          valid: false,
          keyword: "maxLength",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.maxLength,
          actual: length,
        });
      }
    }

    // `pattern` is not evaluated: see `REGEX_KEYWORDS`.

    if (schema.format !== undefined) {
      if (!validateFormat(data, schema.format)) {
        errors.push({
          valid: false,
          keyword: "format",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.format,
          actual: data,
        });
      }
    }
  }

  // ── Numeric validation ───────────────────────────────────────────

  private validateNumber(
    data: number,
    schema: Schema,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
  ): void {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        valid: false,
        keyword: "minimum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.minimum,
        actual: data,
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        valid: false,
        keyword: "maximum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.maximum,
        actual: data,
      });
    }
    if (
      typeof schema.exclusiveMinimum === "number" &&
      data <= schema.exclusiveMinimum
    ) {
      errors.push({
        valid: false,
        keyword: "exclusiveMinimum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.exclusiveMinimum,
        actual: data,
      });
    } else if (
      schema.exclusiveMinimum === true && schema.minimum !== undefined &&
      data <= schema.minimum
    ) {
      errors.push({
        valid: false,
        keyword: "exclusiveMinimum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.minimum,
        actual: data,
      });
    }
    if (
      typeof schema.exclusiveMaximum === "number" &&
      data >= schema.exclusiveMaximum
    ) {
      errors.push({
        valid: false,
        keyword: "exclusiveMaximum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.exclusiveMaximum,
        actual: data,
      });
    } else if (
      schema.exclusiveMaximum === true && schema.maximum !== undefined &&
      data >= schema.maximum
    ) {
      errors.push({
        valid: false,
        keyword: "exclusiveMaximum",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.maximum,
        actual: data,
      });
    }
    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      const division = data / schema.multipleOf;
      const rounded = Math.round(division);
      const isMultiple = Math.abs(division - rounded) <
        Number.EPSILON * Math.max(Math.abs(division), Math.abs(rounded));

      if (!isMultiple && data !== 0) {
        errors.push({
          valid: false,
          keyword: "multipleOf",
          path: dataPath,
          schemaPath: formatFragmentPointer(schemaPath),
          expected: schema.multipleOf,
          actual: data,
        });
      }
    }
  }

  // ── Array validation ─────────────────────────────────────────────

  private validateArray(
    data: unknown[],
    schema: Schema,
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
  ): void {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        valid: false,
        keyword: "minItems",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.minItems,
        actual: data.length,
      });
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        valid: false,
        keyword: "maxItems",
        path: dataPath,
        schemaPath: formatFragmentPointer(schemaPath),
        expected: schema.maxItems,
        actual: data.length,
      });
    }

    // items: validate each element (flattened, indexed paths)
    if (
      schema.items && typeof schema.items === "object" &&
      !Array.isArray(schema.items)
    ) {
      for (let i = 0; i < data.length; i++) {
        this.validateSchema(
          data[i],
          schema.items,
          [...schemaPath, "items"],
          [...dataPath, String(i)],
          errors,
          rootSchema,
          { arrayItem: true },
        );
      }
    }

    // prefixItems: validate positional items
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
        const itemSchema = schema.prefixItems[i];
        if (itemSchema) {
          this.validateSchema(
            data[i],
            itemSchema,
            [...schemaPath, "prefixItems", String(i)],
            [...dataPath, String(i)],
            errors,
            rootSchema,
            { arrayItem: true },
          );
        }
      }
    }

    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i++) {
        const key = canonicalJson(data[i]);
        if (seen.has(key)) {
          errors.push({
            valid: false,
            keyword: "uniqueItems",
            path: dataPath,
            schemaPath: formatFragmentPointer(schemaPath),
            message: `Duplicate item at index ${i}`,
            expected: true,
            actual: false,
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
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    context?: { arrayItem?: boolean },
  ): void {
    const variantResults: ValidationNode[] = [];

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (!variant) continue;

      const variantPath: PointerPath = [...schemaPath, "oneOf", String(i)];
      const variantErrors: ValidationNode[] = [];
      this.validateSchema(
        data,
        variant,
        variantPath,
        dataPath,
        variantErrors,
        rootSchema,
        context,
      );

      const valid = variantErrors.length === 0;
      const variantNode: ValidationNode = {
        valid,
        path: dataPath,
        schemaPath: formatFragmentPointer(variantPath),
        variantIndex: i,
        children: variantErrors.length > 0 ? variantErrors : undefined,
      };
      variantResults.push(variantNode);
    }

    const matchCount = variantResults.filter((v) => v.valid).length;

    // Exactly one match → valid (standard oneOf)
    if (matchCount === 1) return;

    // Zero or multiple matches → composition failure.
    // schemaPath points to the schema containing `oneOf`, matching the
    // leaf keyword convention (the `keyword` field carries "oneOf").
    errors.push({
      valid: false,
      keyword: "oneOf",
      path: dataPath,
      schemaPath: formatFragmentPointer(schemaPath),
      children: variantResults,
    });
  }

  private validateAnyOf(
    data: unknown,
    variants: Schema[],
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    context?: { arrayItem?: boolean },
  ): void {
    const variantResults: ValidationNode[] = [];

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (!variant) continue;

      const variantPath: PointerPath = [...schemaPath, "anyOf", String(i)];
      const variantErrors: ValidationNode[] = [];
      this.validateSchema(
        data,
        variant,
        variantPath,
        dataPath,
        variantErrors,
        rootSchema,
        context,
      );

      const valid = variantErrors.length === 0;
      variantResults.push({
        valid,
        path: dataPath,
        schemaPath: formatFragmentPointer(variantPath),
        variantIndex: i,
        children: variantErrors.length > 0 ? variantErrors : undefined,
      });
    }

    const hasMatch = variantResults.some((v) => v.valid);

    if (hasMatch) return;

    // schemaPath points to the schema containing `anyOf`, matching the
    // leaf keyword convention (the `keyword` field carries "anyOf").
    errors.push({
      valid: false,
      keyword: "anyOf",
      path: dataPath,
      schemaPath: formatFragmentPointer(schemaPath),
      children: variantResults,
    });
  }

  private validateAllOf(
    data: unknown,
    subschemas: Schema[],
    schemaPath: PointerPath,
    dataPath: string[],
    errors: ValidationNode[],
    rootSchema: Schema | boolean,
    context?: { arrayItem?: boolean },
  ): void {
    const childResults: ValidationNode[] = [];
    let allValid = true;

    for (let i = 0; i < subschemas.length; i++) {
      const sub = subschemas[i];
      if (sub === undefined || sub === null) continue;

      const subPath: PointerPath = [...schemaPath, "allOf", String(i)];
      const subErrors: ValidationNode[] = [];
      this.validateSchema(
        data,
        sub,
        subPath,
        dataPath,
        subErrors,
        rootSchema,
        context,
      );

      const valid = subErrors.length === 0;
      if (!valid) allValid = false;

      childResults.push({
        valid,
        path: dataPath,
        schemaPath: formatFragmentPointer(subPath),
        children: subErrors.length > 0 ? subErrors : undefined,
      });
    }

    if (allValid) return;

    // schemaPath points to the schema containing `allOf`, matching the
    // leaf keyword convention (the `keyword` field carries "allOf").
    errors.push({
      valid: false,
      keyword: "allOf",
      path: dataPath,
      schemaPath: formatFragmentPointer(schemaPath),
      children: childResults,
    });
  }

  // ── $ref resolution ──────────────────────────────────────────────

  /**
   * Resolve a $ref, and keep resolving while the result is nothing but
   * another $ref. Returns the first schema that says something, with the
   * reference that names it.
   *
   * A loop instead of recursion: the length of such a chain is up to the
   * spec. `undefined` when a reference does not resolve, or when the chain
   * leads back to itself. A chain that only refers to itself states no
   * constraint, so the caller treats it like an unresolved reference: it
   * accepts.
   */
  private followRef(
    ref: string,
    rootSchema: Schema | boolean,
  ): { schema: Schema | boolean; ref: string } | undefined {
    let current = ref;
    let seen: Set<string> | undefined;
    for (;;) {
      const resolved = this.resolveRef(current, rootSchema);
      if (resolved === undefined) return undefined;
      if (
        typeof resolved === "boolean" || typeof resolved.$ref !== "string" ||
        Object.keys(resolved).length !== 1
      ) {
        return { schema: resolved, ref: current };
      }
      seen ??= new Set([ref]);
      if (seen.has(resolved.$ref)) return undefined;
      seen.add(resolved.$ref);
      current = resolved.$ref;
    }
  }

  /**
   * Note that `schema` is about to be applied to `data` through a $ref.
   * Returns false when that same application is already in progress, which
   * means references lead back to the schema without having moved to a
   * child of the value: `A: {allOf: [{$ref: A}]}`. Validating again would
   * never end, and repeating a check that is already running adds nothing,
   * so the caller skips it. Everything else the schema says is checked by
   * the application that is in progress.
   *
   * `depth` is the length of the data path. A recursive schema that moves
   * into the value (a tree of nodes) reaches the schema again at a greater
   * depth and is validated normally.
   */
  private enterRef(schema: Schema, data: unknown, depth: number): boolean {
    const active = this.activeRefs.get(schema);
    if (active === undefined) {
      this.activeRefs.set(schema, [{ data, depth }]);
      return true;
    }
    for (const entry of active) {
      if (entry.depth === depth && entry.data === data) return false;
    }
    active.push({ data, depth });
    return true;
  }

  private leaveRef(schema: Schema): void {
    const active = this.activeRefs.get(schema);
    if (active === undefined) return;
    active.pop();
    if (active.length === 0) this.activeRefs.delete(schema);
  }

  private resolveRef(
    ref: string,
    rootSchema: Schema | boolean,
  ): Schema | boolean | undefined {
    // Try local resolution first (for in-schema refs like #/$defs/X)
    const local = this.resolveRefLocally(ref, rootSchema);
    if (local !== undefined) return local;

    // Fall back to registry (for document-level refs like #/components/schemas/X)
    if (this.registry) {
      const result = this.registry.resolveRef(ref);
      return result?.raw;
    }

    return undefined;
  }

  /**
   * Resolve a $ref by navigating within the given rootSchema.
   * Returns undefined if the ref can't be resolved locally.
   */
  private resolveRefLocally(
    ref: string,
    rootSchema: Schema | boolean,
  ): Schema | undefined {
    if (!ref.startsWith("#/")) return undefined;

    const pointer = ref.slice(1); // Strip "#"
    const segments = pointer.split("/").slice(1); // Split and drop empty first

    let current: unknown = rootSchema;
    for (const segment of segments) {
      const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!isPlainObject(current)) return undefined;
      current = current[unescaped];
    }

    if (isSchema(current)) {
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

/**
 * Length of a string for minLength / maxLength: the number of characters as
 * defined by RFC 8259, i.e. Unicode code points (JSON Schema Validation
 * section 6.3). `String.length` counts UTF-16 code units and reports 2 for
 * every character outside the Basic Multilingual Plane.
 */
function characterCount(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
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

/**
 * Create a canonical JSON string with sorted object keys.
 * Ensures objects with the same content but different key order
 * produce identical strings for comparison.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }

  if (!isPlainObject(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) =>
    JSON.stringify(k) + ":" + canonicalJson(value[k])
  );
  return "{" + pairs.join(",") + "}";
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
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(value);
    case "date-time":
      return !isNaN(Date.parse(value)) && /T/.test(value);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "ipv4":
      return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
    case "ipv6":
      return value.includes(":");
    default:
      // Unknown format, pass (conservative)
      return true;
  }
}
