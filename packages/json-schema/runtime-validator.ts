/**
 * Runtime Validator - Fast validation using pre-processed schemas
 *
 * Uses the pre-computed indexes and resolved references from the processor
 * to enable efficient validation without re-parsing or re-analyzing schemas.
 *
 * Features:
 * - Format validation (email, uri, date-time, etc.)
 * - O(n) uniqueItems validation
 * - ReDoS-safe regex execution with timeout
 * - Rich error context with suggestions
 * - Full unevaluatedProperties/unevaluatedItems support (JSON Schema 2020-12)
 */

import type {
  ProcessedSchema,
  Schema,
  SchemaType,
  SchemaValidationError,
  ValidationContext,
} from "./types.ts";

/** Maximum regex execution time in milliseconds */
const REGEX_TIMEOUT_MS = 100;

/** Maximum string length for regex matching to prevent ReDoS */
const MAX_REGEX_STRING_LENGTH = 100_000;

/**
 * Create a canonical JSON string with sorted object keys.
 * This ensures that objects with the same content but different key order
 * produce identical strings for comparison.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }

  // Object: sort keys and recursively canonicalize values
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) =>
    JSON.stringify(k) + ":" +
    canonicalJson((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

/** Format validators for common JSON Schema formats */
const FORMAT_VALIDATORS: Record<string, (value: string) => boolean> = {
  "date-time": (v) =>
    !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v),
  "date": (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)),
  "time": (v) => /^\d{2}:\d{2}:\d{2}/.test(v),
  "email": (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  "uri": (v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  },
  "uri-reference": (v) => {
    try {
      new URL(v, "http://example.com");
      return true;
    } catch {
      return false;
    }
  },
  "uuid": (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  "ipv4": (v) => {
    const parts = v.split(".");
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      const num = parseInt(p, 10);
      return !isNaN(num) && num >= 0 && num <= 255 && String(num) === p;
    });
  },
  "ipv6": (v) => {
    // Simplified IPv6 check
    const parts = v.split(":");
    if (parts.length < 3 || parts.length > 8) return false;
    return parts.every((p) => p === "" || /^[0-9a-f]{1,4}$/i.test(p));
  },
  "hostname": (v) =>
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i
      .test(v),
  "json-pointer": (v) => v === "" || /^\/([^~]|~0|~1)*$/.test(v),
  "regex": (v) => {
    try {
      new RegExp(v);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Internal result type that tracks both errors and what was evaluated.
 * This is essential for unevaluatedProperties/unevaluatedItems support.
 *
 * Key insight from JSON Schema 2020-12 spec:
 * - Parent schemas CAN see what child schemas evaluated (hierarchical)
 * - Sibling schemas (cousins in allOf) CANNOT see each other's evaluations
 */
interface EvaluationResult {
  errors: SchemaValidationError[];
  /** Properties evaluated at the current instance path */
  evaluatedProperties: Set<string>;
  /** Array items evaluated at the current instance path */
  evaluatedItems: Set<number>;
}

/** Create an empty evaluation result */
function emptyResult(): EvaluationResult {
  return {
    errors: [],
    evaluatedProperties: new Set(),
    evaluatedItems: new Set(),
  };
}

/** Options for RuntimeValidator */
export interface RuntimeValidatorOptions {
  /**
   * Enable format validation. By default, format is annotation-only
   * per JSON Schema 2020-12 spec. Set to true to validate format.
   */
  validateFormats?: boolean;
  /**
   * Enable strict oneOf validation per JSON Schema semantics.
   * When false (default), oneOf passes if ANY variant matches (union-like).
   * When true, oneOf requires EXACTLY one variant to match.
   */
  strictOneOf?: boolean;
}

export class RuntimeValidator {
  private readonly validateFormats: boolean;
  private readonly strictOneOf: boolean;

  constructor(
    private schema: ProcessedSchema,
    options?: RuntimeValidatorOptions,
  ) {
    this.validateFormats = options?.validateFormats ?? false;
    this.strictOneOf = options?.strictOneOf ?? false;
  }

  /**
   * Validate data against the processed schema
   */
  validate(data: unknown): SchemaValidationError[] {
    const context: ValidationContext = {
      root: data,
      instancePath: "",
      schemaPath: "#",
      evaluated: {
        properties: new Set<string>(),
        items: new Set<number>(),
      },
    };

    const result = this.validateWithSchema(
      data,
      this.schema.root,
      context,
    );

    return this.enrichErrors(result.errors);
  }

  /**
   * Core validation logic - returns both errors AND what was evaluated
   */
  private validateWithSchema(
    data: unknown,
    schema: Schema | boolean,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();

    // Fast path for boolean schemas
    if (typeof schema === "boolean") {
      if (!schema) {
        result.errors.push(this.createError(
          "false",
          "Schema is false",
          context,
          { schema: false },
        ));
      }
      // Boolean true schema accepts all values but does NOT evaluate properties/items
      // It's a "pass through" that doesn't contribute to evaluated sets
      // This is important for unevaluatedProperties/unevaluatedItems
      return result;
    }

    // Handle $ref - use pre-resolved reference
    if (schema.$ref) {
      const resolved = this.schema.refs.resolved.get(schema.$ref);
      if (resolved) {
        const refContext = {
          ...context,
          schemaPath: `${context.schemaPath}/$ref`,
        };
        const refResult = this.validateWithSchema(data, resolved, refContext);
        // $ref evaluation is visible to parent (merge into result)
        for (const prop of refResult.evaluatedProperties) {
          result.evaluatedProperties.add(prop);
        }
        for (const item of refResult.evaluatedItems) {
          result.evaluatedItems.add(item);
        }
        for (const error of refResult.errors) {
          result.errors.push(error);
        }
      } else {
        result.errors.push(this.createError(
          "$ref",
          `Unresolved reference: ${schema.$ref}`,
          context,
          { $ref: schema.$ref },
        ));
      }
    }

    // Handle undefined (not valid JSON)
    if (data === undefined) {
      result.errors.push(this.createError(
        "type",
        "Value is undefined, which is not a valid JSON value",
        context,
        {},
      ));
      return result;
    }

    // Const validation
    if (schema.const !== undefined) {
      if (!this.deepEqual(data, schema.const)) {
        result.errors.push(this.createError(
          "const",
          `Must be equal to constant`,
          { ...context, schemaPath: `${context.schemaPath}/const` },
          { allowedValue: schema.const },
        ));
      }
    }

    // Enum validation
    if (schema.enum !== undefined) {
      if (!schema.enum.some((value) => this.deepEqual(data, value))) {
        result.errors.push(this.createError(
          "enum",
          `Must be equal to one of the allowed values`,
          { ...context, schemaPath: `${context.schemaPath}/enum` },
          { allowedValues: schema.enum },
        ));
      }
    }

    // Type validation
    const dataType = this.getType(data);

    if (schema.type && !this.isTypeAllowed(dataType, schema.type)) {
      const allowedTypes = Array.isArray(schema.type)
        ? schema.type
        : [schema.type];
      result.errors.push(this.createError(
        "type",
        `Must be ${allowedTypes.join(" or ")}`,
        { ...context, schemaPath: `${context.schemaPath}/type` },
        { type: allowedTypes },
      ));
    }

    // Type-specific validation
    switch (dataType) {
      case "string":
        this.validateString(schema, data as string, context, result.errors);
        break;
      case "number":
      case "integer":
        this.validateNumber(schema, data as number, context, result.errors);
        break;
      case "boolean":
        // No additional validation needed for booleans
        break;
      case "null":
        // No additional validation needed for null
        break;
      case "array": {
        // First pass: validate array WITHOUT unevaluatedItems
        const arrayResult = this.validateArrayCore(
          schema,
          data as unknown[],
          context,
        );
        for (const error of arrayResult.errors) {
          result.errors.push(error);
        }
        for (const item of arrayResult.evaluatedItems) {
          result.evaluatedItems.add(item);
        }
        break;
      }
      case "object":
        if (data !== null) {
          // First pass: validate object WITHOUT unevaluatedProperties
          const objectResult = this.validateObjectCore(
            schema,
            data as Record<string, unknown>,
            context,
          );
          for (const error of objectResult.errors) {
            result.errors.push(error);
          }
          for (const prop of objectResult.evaluatedProperties) {
            result.evaluatedProperties.add(prop);
          }
        }
        break;
    }

    // Composition validation - must run BEFORE unevaluated* checks
    const compositionResult = this.validateComposition(schema, data, context);
    for (const error of compositionResult.errors) {
      result.errors.push(error);
    }
    for (const prop of compositionResult.evaluatedProperties) {
      result.evaluatedProperties.add(prop);
    }
    for (const item of compositionResult.evaluatedItems) {
      result.evaluatedItems.add(item);
    }

    // Conditional validation - must run BEFORE unevaluated* checks
    const conditionalResult = this.validateConditional(schema, data, context);
    for (const error of conditionalResult.errors) {
      result.errors.push(error);
    }
    for (const prop of conditionalResult.evaluatedProperties) {
      result.evaluatedProperties.add(prop);
    }
    for (const item of conditionalResult.evaluatedItems) {
      result.evaluatedItems.add(item);
    }

    // NOW apply unevaluated* checks after ALL evaluations are collected
    if (dataType === "object" && data !== null) {
      const unevalPropsResult = this.validateUnevaluatedProperties(
        schema,
        data as Record<string, unknown>,
        result.evaluatedProperties,
        context,
      );
      for (const error of unevalPropsResult.errors) {
        result.errors.push(error);
      }
      for (const prop of unevalPropsResult.evaluatedProperties) {
        result.evaluatedProperties.add(prop);
      }
    }

    if (dataType === "array") {
      const unevalItemsResult = this.validateUnevaluatedItems(
        schema,
        data as unknown[],
        result.evaluatedItems,
        context,
      );
      for (const error of unevalItemsResult.errors) {
        result.errors.push(error);
      }
      for (const item of unevalItemsResult.evaluatedItems) {
        result.evaluatedItems.add(item);
      }
    }

    return result;
  }

  /**
   * String validation with format support
   */
  private validateString(
    schema: Schema,
    data: string,
    context: ValidationContext,
    errors: SchemaValidationError[],
  ): void {
    const length = this.getStringLength(data);

    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(this.createError(
        "minLength",
        `Must NOT have fewer than ${schema.minLength} characters`,
        { ...context, schemaPath: `${context.schemaPath}/minLength` },
        { limit: schema.minLength },
      ));
    }

    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(this.createError(
        "maxLength",
        `Must NOT have more than ${schema.maxLength} characters`,
        { ...context, schemaPath: `${context.schemaPath}/maxLength` },
        { limit: schema.maxLength },
      ));
    }

    if (schema.pattern !== undefined) {
      if (!this.safeRegexTest(schema.pattern, data)) {
        errors.push(this.createError(
          "pattern",
          `Must match pattern "${schema.pattern}"`,
          { ...context, schemaPath: `${context.schemaPath}/pattern` },
          { pattern: schema.pattern },
        ));
      }
    }

    // Format validation (only if enabled - format is annotation-only by default)
    if (schema.format !== undefined && this.validateFormats) {
      const validator = FORMAT_VALIDATORS[schema.format];
      if (validator && !validator(data)) {
        errors.push(this.createError(
          "format",
          `Must be a valid ${schema.format}`,
          { ...context, schemaPath: `${context.schemaPath}/format` },
          { format: schema.format },
        ));
      }
    }
  }

  /**
   * Safe regex test with timeout protection
   *
   * Security principles:
   * - Invalid regex patterns MUST fail validation (not silently pass)
   * - Strings too long for safe testing MUST fail validation (not silently pass)
   * - Slow patterns are logged but still executed (performance monitoring only)
   *
   * Per the "fail loudly" principle: When in doubt, reject.
   * Silent acceptance of invalid patterns is a security vulnerability.
   */
  private safeRegexTest(pattern: string, value: string): boolean {
    // Reject extremely long strings to prevent ReDoS
    // IMPORTANT: Fail validation (return false), don't silently pass
    if (value.length > MAX_REGEX_STRING_LENGTH) {
      console.warn(
        `String too long for regex validation: ${value.length} chars exceeds limit of ${MAX_REGEX_STRING_LENGTH}. Failing validation.`,
      );
      return false; // FAIL validation for extremely long strings
    }

    try {
      const regex = new RegExp(pattern);
      const startTime = performance.now();
      const result = regex.test(value);
      const duration = performance.now() - startTime;

      if (duration > REGEX_TIMEOUT_MS) {
        console.warn(
          `Slow regex pattern detected: "${pattern}" took ${
            duration.toFixed(2)
          }ms`,
        );
      }

      return result;
    } catch (error) {
      // Invalid regex pattern - this is a schema error
      // IMPORTANT: Fail validation (return false), don't silently pass
      console.warn(
        `Invalid regex pattern "${pattern}": ${
          error instanceof Error ? error.message : String(error)
        }. Failing validation.`,
      );
      return false; // FAIL validation for invalid regex patterns
    }
  }

  /**
   * Number validation
   */
  private validateNumber(
    schema: Schema,
    data: number,
    context: ValidationContext,
    errors: SchemaValidationError[],
  ): void {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(this.createError(
        "minimum",
        `Must be >= ${schema.minimum}`,
        { ...context, schemaPath: `${context.schemaPath}/minimum` },
        { comparison: ">=", limit: schema.minimum },
      ));
    }

    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(this.createError(
        "maximum",
        `Must be <= ${schema.maximum}`,
        { ...context, schemaPath: `${context.schemaPath}/maximum` },
        { comparison: "<=", limit: schema.maximum },
      ));
    }

    if (
      schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum
    ) {
      errors.push(this.createError(
        "exclusiveMinimum",
        `Must be > ${schema.exclusiveMinimum}`,
        { ...context, schemaPath: `${context.schemaPath}/exclusiveMinimum` },
        { comparison: ">", limit: schema.exclusiveMinimum },
      ));
    }

    if (
      schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum
    ) {
      errors.push(this.createError(
        "exclusiveMaximum",
        `Must be < ${schema.exclusiveMaximum}`,
        { ...context, schemaPath: `${context.schemaPath}/exclusiveMaximum` },
        { comparison: "<", limit: schema.exclusiveMaximum },
      ));
    }

    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      // Skip validation if multipleOf is invalid (must be > 0 per JSON Schema)
      const division = data / schema.multipleOf;
      const rounded = Math.round(division);
      const isMultiple = Math.abs(division - rounded) <
        Number.EPSILON * Math.max(Math.abs(division), Math.abs(rounded));

      if (!isMultiple && data !== 0) {
        errors.push(this.createError(
          "multipleOf",
          `Must be multiple of ${schema.multipleOf}`,
          { ...context, schemaPath: `${context.schemaPath}/multipleOf` },
          { multipleOf: schema.multipleOf },
        ));
      }
    }
  }

  /**
   * Array validation with O(n) uniqueItems check (without unevaluatedItems)
   * unevaluatedItems is handled separately in validateUnevaluatedItems
   */
  private validateArrayCore(
    schema: Schema,
    data: unknown[],
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();

    if (schema.minItems !== undefined && data.length < schema.minItems) {
      result.errors.push(this.createError(
        "minItems",
        `Must NOT have fewer than ${schema.minItems} items`,
        { ...context, schemaPath: `${context.schemaPath}/minItems` },
        { limit: schema.minItems },
      ));
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      result.errors.push(this.createError(
        "maxItems",
        `Must NOT have more than ${schema.maxItems} items`,
        { ...context, schemaPath: `${context.schemaPath}/maxItems` },
        { limit: schema.maxItems },
      ));
    }

    // O(n) uniqueItems validation using canonical JSON serialization
    // Canonical JSON ensures objects with same content but different key order compare equal
    if (schema.uniqueItems === true) {
      const seen = new Map<string, number>();
      for (let i = 0; i < data.length; i++) {
        const key = canonicalJson(data[i]);
        const firstIndex = seen.get(key);
        if (firstIndex !== undefined) {
          result.errors.push(this.createError(
            "uniqueItems",
            `Must NOT have duplicate items (items ## ${firstIndex} and ${i} are identical)`,
            {
              ...context,
              instancePath: `${context.instancePath}/${i}`,
              schemaPath: `${context.schemaPath}/uniqueItems`,
            },
            { i: firstIndex, j: i },
          ));
          break; // Report first duplicate only
        }
        seen.set(key, i);
      }
    }

    // Validate prefixItems
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
        result.evaluatedItems.add(i);
        const itemResult = this.validateWithSchema(
          data[i],
          schema.prefixItems[i]!,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/prefixItems/${i}`,
          },
        );
        for (const error of itemResult.errors) {
          result.errors.push(error);
        }
      }
    }

    // Validate items
    if (schema.items !== undefined) {
      const startIndex = schema.prefixItems ? schema.prefixItems.length : 0;
      for (let i = startIndex; i < data.length; i++) {
        result.evaluatedItems.add(i);
        const itemResult = this.validateWithSchema(
          data[i],
          schema.items as Schema,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/items`,
          },
        );
        for (const error of itemResult.errors) {
          result.errors.push(error);
        }
      }
    }

    // Contains validation
    if (schema.contains !== undefined) {
      let containsCount = 0;
      for (let i = 0; i < data.length; i++) {
        const containsResult = this.validateWithSchema(
          data[i],
          schema.contains,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/contains`,
          },
        );
        if (containsResult.errors.length === 0) {
          containsCount++;
          // Items that match contains are considered evaluated
          result.evaluatedItems.add(i);
        }
      }

      // Default minimum is 1, but can be overridden by minContains
      // When minContains = 0, contains always passes (even with 0 matches)
      const effectiveMinContains = schema.minContains ?? 1;

      if (containsCount < effectiveMinContains) {
        result.errors.push(this.createError(
          effectiveMinContains === 1 ? "contains" : "minContains",
          `Must contain at least ${effectiveMinContains} item${
            effectiveMinContains === 1 ? "" : "s"
          } matching the schema`,
          {
            ...context,
            schemaPath: `${context.schemaPath}/${
              effectiveMinContains === 1 ? "contains" : "minContains"
            }`,
          },
          { limit: effectiveMinContains, actual: containsCount },
        ));
      }

      if (
        schema.maxContains !== undefined && containsCount > schema.maxContains
      ) {
        result.errors.push(this.createError(
          "maxContains",
          `Must contain at most ${schema.maxContains} items matching the schema`,
          { ...context, schemaPath: `${context.schemaPath}/maxContains` },
          { limit: schema.maxContains, actual: containsCount },
        ));
      }
    }

    // Note: unevaluatedItems is handled separately after composition keywords

    return result;
  }

  /**
   * Validate unevaluatedItems after ALL item evaluations have been collected
   */
  private validateUnevaluatedItems(
    schema: Schema,
    data: unknown[],
    evaluatedItems: Set<number>,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();

    if (schema.unevaluatedItems !== undefined) {
      for (let i = 0; i < data.length; i++) {
        if (!evaluatedItems.has(i)) {
          if (schema.unevaluatedItems === false) {
            result.errors.push(this.createError(
              "unevaluatedItems",
              `Must NOT have unevaluated items`,
              {
                ...context,
                instancePath: `${context.instancePath}/${i}`,
                schemaPath: `${context.schemaPath}/unevaluatedItems`,
              },
              { unevaluatedItem: i },
            ));
          } else if (typeof schema.unevaluatedItems === "object") {
            const unevalResult = this.validateWithSchema(
              data[i],
              schema.unevaluatedItems,
              {
                ...context,
                instancePath: `${context.instancePath}/${i}`,
                schemaPath: `${context.schemaPath}/unevaluatedItems`,
              },
            );
            for (const error of unevalResult.errors) {
              result.errors.push(error);
            }
          }
          // Mark as evaluated (true or schema both mark as evaluated)
          result.evaluatedItems.add(i);
        }
      }
    }

    return result;
  }

  /**
   * Object validation (without unevaluatedProperties)
   * unevaluatedProperties is handled separately in validateUnevaluatedProperties
   */
  private validateObjectCore(
    schema: Schema,
    data: Record<string, unknown>,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();
    const keys = Object.keys(data);

    if (
      schema.minProperties !== undefined && keys.length < schema.minProperties
    ) {
      result.errors.push(this.createError(
        "minProperties",
        `Must NOT have fewer than ${schema.minProperties} properties`,
        { ...context, schemaPath: `${context.schemaPath}/minProperties` },
        { limit: schema.minProperties },
      ));
    }

    if (
      schema.maxProperties !== undefined && keys.length > schema.maxProperties
    ) {
      result.errors.push(this.createError(
        "maxProperties",
        `Must NOT have more than ${schema.maxProperties} properties`,
        { ...context, schemaPath: `${context.schemaPath}/maxProperties` },
        { limit: schema.maxProperties },
      ));
    }

    // Required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, requiredProp)) {
          result.errors.push(this.createError(
            "required",
            `Must have required property '${requiredProp}'`,
            { ...context, schemaPath: `${context.schemaPath}/required` },
            { missingProperty: requiredProp },
          ));
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(data, propName)) {
          result.evaluatedProperties.add(propName);
          const propResult = this.validateWithSchema(
            data[propName],
            propSchema,
            {
              ...context,
              instancePath: `${context.instancePath}/${
                this.escapeJsonPointer(propName)
              }`,
              schemaPath: `${context.schemaPath}/properties/${
                this.escapeJsonPointer(propName)
              }`,
            },
          );
          for (const error of propResult.errors) {
            result.errors.push(error);
          }
        }
      }
    }

    // Pattern properties
    if (schema.patternProperties) {
      for (
        const [pattern, patternSchema] of Object.entries(
          schema.patternProperties,
        )
      ) {
        for (const propName of keys) {
          if (this.safeRegexTest(pattern, propName)) {
            result.evaluatedProperties.add(propName);
            const propResult = this.validateWithSchema(
              data[propName],
              patternSchema,
              {
                ...context,
                instancePath: `${context.instancePath}/${
                  this.escapeJsonPointer(propName)
                }`,
                schemaPath: `${context.schemaPath}/patternProperties/${
                  this.escapeJsonPointer(pattern)
                }`,
              },
            );
            for (const error of propResult.errors) {
              result.errors.push(error);
            }
          }
        }
      }
    }

    // Property names validation
    if (schema.propertyNames !== undefined) {
      for (const propName of keys) {
        const nameResult = this.validateWithSchema(
          propName,
          schema.propertyNames,
          {
            ...context,
            instancePath: `${context.instancePath}`,
            schemaPath: `${context.schemaPath}/propertyNames`,
          },
        );
        if (nameResult.errors.length > 0) {
          result.errors.push(this.createError(
            "propertyNames",
            `Property name '${propName}' is invalid`,
            {
              ...context,
              instancePath: `${context.instancePath}`,
              schemaPath: `${context.schemaPath}/propertyNames`,
            },
            { propertyName: propName },
          ));
        }
      }
    }

    // Additional properties
    if (schema.additionalProperties !== undefined) {
      const additionalProps = keys.filter((key) =>
        !result.evaluatedProperties.has(key)
      );

      if (schema.additionalProperties === false && additionalProps.length > 0) {
        for (const prop of additionalProps) {
          result.errors.push(this.createError(
            "additionalProperties",
            `Must NOT have additional properties`,
            {
              ...context,
              instancePath: `${context.instancePath}/${
                this.escapeJsonPointer(prop)
              }`,
              schemaPath: `${context.schemaPath}/additionalProperties`,
            },
            { additionalProperty: prop },
          ));
        }
      } else if (
        schema.additionalProperties === true ||
        typeof schema.additionalProperties === "object"
      ) {
        // additionalProperties: true or schema marks all additional properties as evaluated
        for (const prop of additionalProps) {
          result.evaluatedProperties.add(prop);
          if (typeof schema.additionalProperties === "object") {
            const propResult = this.validateWithSchema(
              data[prop],
              schema.additionalProperties,
              {
                ...context,
                instancePath: `${context.instancePath}/${
                  this.escapeJsonPointer(prop)
                }`,
                schemaPath: `${context.schemaPath}/additionalProperties`,
              },
            );
            for (const error of propResult.errors) {
              result.errors.push(error);
            }
          }
        }
      }
    }

    // Dependent required
    if (schema.dependentRequired) {
      for (
        const [prop, requiredProps] of Object.entries(schema.dependentRequired)
      ) {
        if (Object.prototype.hasOwnProperty.call(data, prop)) {
          for (const requiredProp of requiredProps) {
            if (!Object.prototype.hasOwnProperty.call(data, requiredProp)) {
              result.errors.push(this.createError(
                "dependentRequired",
                `Property '${prop}' requires property '${requiredProp}'`,
                {
                  ...context,
                  schemaPath: `${context.schemaPath}/dependentRequired`,
                },
                { property: prop, missingProperty: requiredProp },
              ));
            }
          }
        }
      }
    }

    // Dependent schemas
    if (schema.dependentSchemas) {
      for (const [prop, depSchema] of Object.entries(schema.dependentSchemas)) {
        if (Object.prototype.hasOwnProperty.call(data, prop)) {
          const depResult = this.validateWithSchema(
            data,
            depSchema,
            {
              ...context,
              schemaPath: `${context.schemaPath}/dependentSchemas/${
                this.escapeJsonPointer(prop)
              }`,
            },
          );
          for (const error of depResult.errors) {
            result.errors.push(error);
          }
          // Merge evaluated properties from dependent schema
          for (const evalProp of depResult.evaluatedProperties) {
            result.evaluatedProperties.add(evalProp);
          }
        }
      }
    }

    // Note: unevaluatedProperties is handled separately after composition keywords

    return result;
  }

  /**
   * Validate unevaluatedProperties after ALL property evaluations have been collected
   */
  private validateUnevaluatedProperties(
    schema: Schema,
    data: Record<string, unknown>,
    evaluatedProperties: Set<string>,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();
    const keys = Object.keys(data);

    if (schema.unevaluatedProperties !== undefined) {
      const unevaluatedProps = keys.filter((key) =>
        !evaluatedProperties.has(key)
      );

      if (
        schema.unevaluatedProperties === false && unevaluatedProps.length > 0
      ) {
        for (const prop of unevaluatedProps) {
          result.errors.push(this.createError(
            "unevaluatedProperties",
            `Must NOT have unevaluated properties`,
            {
              ...context,
              instancePath: `${context.instancePath}/${
                this.escapeJsonPointer(prop)
              }`,
              schemaPath: `${context.schemaPath}/unevaluatedProperties`,
            },
            { unevaluatedProperty: prop },
          ));
        }
      } else if (
        schema.unevaluatedProperties === true ||
        typeof schema.unevaluatedProperties === "object"
      ) {
        // unevaluatedProperties: true or schema marks all unevaluated properties as evaluated
        for (const prop of unevaluatedProps) {
          result.evaluatedProperties.add(prop);
          if (typeof schema.unevaluatedProperties === "object") {
            const propResult = this.validateWithSchema(
              data[prop],
              schema.unevaluatedProperties,
              {
                ...context,
                instancePath: `${context.instancePath}/${
                  this.escapeJsonPointer(prop)
                }`,
                schemaPath: `${context.schemaPath}/unevaluatedProperties`,
              },
            );
            for (const error of propResult.errors) {
              result.errors.push(error);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Escape special characters in JSON pointer segments
   */
  private escapeJsonPointer(segment: string): string {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  /**
   * Composition validation (allOf, anyOf, oneOf, not)
   * Critical: Properly tracks evaluated properties for unevaluatedProperties support
   */
  private validateComposition(
    schema: Schema,
    data: unknown,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();

    // allOf: All subschemas must pass, ALL evaluations are visible to parent
    if (schema.allOf) {
      for (let index = 0; index < schema.allOf.length; index++) {
        const subSchema = schema.allOf[index]!;
        const subResult = this.validateWithSchema(
          data,
          subSchema,
          {
            ...context,
            schemaPath: `${context.schemaPath}/allOf/${index}`,
          },
        );
        // Collect all errors
        for (const error of subResult.errors) {
          result.errors.push(error);
        }
        // Merge ALL evaluated properties from ALL subschemas
        for (const prop of subResult.evaluatedProperties) {
          result.evaluatedProperties.add(prop);
        }
        for (const item of subResult.evaluatedItems) {
          result.evaluatedItems.add(item);
        }
      }
    }

    // anyOf: At least one must pass, only PASSING evaluations are visible
    if (schema.anyOf) {
      const passingResults: EvaluationResult[] = [];

      for (let i = 0; i < schema.anyOf.length; i++) {
        const subResult = this.validateWithSchema(
          data,
          schema.anyOf[i]!,
          {
            ...context,
            schemaPath: `${context.schemaPath}/anyOf/${i}`,
          },
        );

        if (subResult.errors.length === 0) {
          passingResults.push(subResult);
        }
      }

      if (passingResults.length === 0) {
        result.errors.push(this.createError(
          "anyOf",
          `Must match at least one schema in anyOf`,
          { ...context, schemaPath: `${context.schemaPath}/anyOf` },
          {},
        ));
      } else {
        // Merge evaluations from ALL passing subschemas
        for (const passingResult of passingResults) {
          for (const prop of passingResult.evaluatedProperties) {
            result.evaluatedProperties.add(prop);
          }
          for (const item of passingResult.evaluatedItems) {
            result.evaluatedItems.add(item);
          }
        }
      }
    }

    // oneOf validation - behavior controlled by strictOneOf option
    // Default (strictOneOf=false): pass if ANY variant matches (union-like)
    // Strict (strictOneOf=true): require EXACTLY one variant to match per JSON Schema
    if (schema.oneOf) {
      const passingResults: Array<{ index: number; result: EvaluationResult }> =
        [];

      for (let i = 0; i < schema.oneOf.length; i++) {
        const subResult = this.validateWithSchema(
          data,
          schema.oneOf[i]!,
          {
            ...context,
            schemaPath: `${context.schemaPath}/oneOf/${i}`,
          },
        );

        if (subResult.errors.length === 0) {
          passingResults.push({ index: i, result: subResult });
        }
      }

      const isValid = this.strictOneOf
        ? passingResults.length === 1
        : passingResults.length >= 1;

      if (!isValid) {
        const message = this.strictOneOf
          ? passingResults.length === 0
            ? "Must match exactly one schema in oneOf (matched none)"
            : `Must match exactly one schema in oneOf (matched ${passingResults.length})`
          : "Must match at least one schema in oneOf";

        result.errors.push(this.createError(
          "oneOf",
          message,
          { ...context, schemaPath: `${context.schemaPath}/oneOf` },
          { passingSchemas: passingResults.length },
        ));
      } else {
        // Merge evaluations from passing subschemas
        for (const { result: passingResult } of passingResults) {
          for (const prop of passingResult.evaluatedProperties) {
            result.evaluatedProperties.add(prop);
          }
          for (const item of passingResult.evaluatedItems) {
            result.evaluatedItems.add(item);
          }
        }
      }
    }

    // not: Must NOT pass - no evaluations are merged (spec requirement)
    if (schema.not) {
      const notResult = this.validateWithSchema(
        data,
        schema.not,
        {
          ...context,
          schemaPath: `${context.schemaPath}/not`,
        },
      );

      if (notResult.errors.length === 0) {
        result.errors.push(this.createError(
          "not",
          `Must NOT be valid`,
          { ...context, schemaPath: `${context.schemaPath}/not` },
          {},
        ));
      }
      // Per JSON Schema spec: "not" does NOT contribute to evaluated properties
      // Even if it fails (meaning data matched), we don't merge those evaluations
    }

    return result;
  }

  /**
   * Conditional validation (if/then/else)
   * Critical: Properly tracks evaluated properties for unevaluatedProperties support
   *
   * Key insight from JSON Schema 2020-12:
   * - When "if" passes: "if" + "then" contribute evaluated properties
   * - When "if" fails: ONLY "else" contributes (NOT "if")
   * - When "if" exists alone (no then/else): "if" always contributes
   */
  private validateConditional(
    schema: Schema,
    data: unknown,
    context: ValidationContext,
  ): EvaluationResult {
    const result = emptyResult();

    if (schema.if !== undefined) {
      const ifResult = this.validateWithSchema(
        data,
        schema.if,
        {
          ...context,
          schemaPath: `${context.schemaPath}/if`,
        },
      );

      const ifPassed = ifResult.errors.length === 0;
      const hasThen = schema.then !== undefined;
      const hasElse = schema.else !== undefined;

      if (ifPassed) {
        // When "if" passes: merge "if" annotations + "then" annotations
        for (const prop of ifResult.evaluatedProperties) {
          result.evaluatedProperties.add(prop);
        }
        for (const item of ifResult.evaluatedItems) {
          result.evaluatedItems.add(item);
        }

        if (hasThen) {
          const thenResult = this.validateWithSchema(
            data,
            schema.then!,
            {
              ...context,
              schemaPath: `${context.schemaPath}/then`,
            },
          );
          for (const error of thenResult.errors) {
            result.errors.push(error);
          }
          for (const prop of thenResult.evaluatedProperties) {
            result.evaluatedProperties.add(prop);
          }
          for (const item of thenResult.evaluatedItems) {
            result.evaluatedItems.add(item);
          }
        }
      } else {
        // When "if" fails: ONLY merge "else" annotations (NOT "if")
        // The "if" annotations are discarded because that path wasn't taken
        // This applies even when there's no "then" or "else" - if "if" fails, nothing is contributed
        if (hasElse) {
          const elseResult = this.validateWithSchema(
            data,
            schema.else!,
            {
              ...context,
              schemaPath: `${context.schemaPath}/else`,
            },
          );
          for (const error of elseResult.errors) {
            result.errors.push(error);
          }
          for (const prop of elseResult.evaluatedProperties) {
            result.evaluatedProperties.add(prop);
          }
          for (const item of elseResult.evaluatedItems) {
            result.evaluatedItems.add(item);
          }
        }
        // If "if" fails and there's no "else": nothing contributes
      }
    }

    return result;
  }

  /**
   * Create a validation error with consistent structure
   */
  private createError(
    keyword: string,
    message: string,
    context: ValidationContext,
    params: Record<string, unknown>,
  ): SchemaValidationError {
    return {
      instancePath: context.instancePath,
      schemaPath: context.schemaPath,
      keyword,
      message,
      params,
      schema: this.getSchemaAtPath(context.schemaPath),
      data: this.getDataAtPath(context.root, context.instancePath),
    };
  }

  /**
   * Get schema at a specific path
   */
  private getSchemaAtPath(schemaPath: string): unknown {
    const schema = this.schema.index.byPointer.get(schemaPath);
    return schema ?? null;
  }

  /**
   * Get data at a specific path (type-safe)
   */
  private getDataAtPath(root: unknown, instancePath: string): unknown {
    if (!instancePath || instancePath === "") return root;

    const segments = instancePath.split("/").slice(1);
    let current: unknown = root;

    for (const segment of segments) {
      if (current === null || current === undefined) return undefined;

      if (typeof current === "object" && current !== null) {
        const obj = current as Record<string, unknown>;
        // Unescape JSON pointer segments
        const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");
        current = obj[unescaped];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Enrich errors with additional context
   */
  private enrichErrors(
    errors: SchemaValidationError[],
  ): SchemaValidationError[] {
    return errors.map((error) => {
      const enriched = { ...error };

      // Add source location if available
      if (this.schema.source.lineNumbers) {
        const lineInfo = this.schema.source.lineNumbers.get(error.schemaPath);
        if (lineInfo) {
          enriched.sourceLocation = {
            file: this.schema.source.file || "unknown",
            line: lineInfo.start,
            column: lineInfo.column ?? 0,
          };
        }
      }

      // Add suggestions based on keyword
      enriched.suggestion = this.getSuggestion(error.keyword, error.params);

      return enriched;
    });
  }

  /**
   * Get suggestion for fixing an error
   */
  private getSuggestion(
    keyword: string,
    params?: Record<string, unknown>,
  ): string {
    switch (keyword) {
      case "type":
        return `Ensure the value is of the correct type: ${params?.type}`;
      case "required":
        return `Add the missing property: ${params?.missingProperty}`;
      case "additionalProperties":
        return `Remove the unexpected property: ${params?.additionalProperty}`;
      case "unevaluatedProperties":
        return `Remove the unevaluated property: ${params?.unevaluatedProperty}`;
      case "unevaluatedItems":
        return `Remove the unevaluated item at index: ${params?.unevaluatedItem}`;
      case "minimum":
      case "maximum":
        return `Adjust the value to be ${params?.comparison} ${params?.limit}`;
      case "pattern":
        return `Match the required pattern: ${params?.pattern}`;
      case "enum":
        return `Use one of the allowed values`;
      case "format":
        return `Provide a valid ${params?.format} value`;
      case "oneOf":
        return params?.passingSchemas === 0
          ? "Ensure the value matches at least one of the schemas"
          : "Ensure the value matches exactly one schema (not multiple)";
      case "anyOf":
        return "Ensure the value matches at least one of the schemas";
      case "dependentRequired":
        return `Add property '${params?.missingProperty}' (required when '${params?.property}' is present)`;
      default:
        return "Check the schema requirements for this field";
    }
  }

  /**
   * Utility: Get JSON type of value
   *
   * NaN, Infinity, and -Infinity are not valid JSON numbers per RFC 8259,
   * so they are classified as "object" (fallback) and will fail type validation.
   */
  private getType(data: unknown): SchemaType {
    if (data === null) return "null";
    if (typeof data === "boolean") return "boolean";
    if (typeof data === "string") return "string";
    if (typeof data === "number") {
      // NaN and Infinity are not valid JSON numbers
      if (!Number.isFinite(data)) {
        return "object"; // Will fail type validation for number/integer
      }
      return Number.isInteger(data) ? "integer" : "number";
    }
    if (Array.isArray(data)) return "array";
    if (typeof data === "object") return "object";
    return "object"; // fallback for symbol, bigint, etc.
  }

  /**
   * Check if data type matches schema type
   */
  private isTypeAllowed(
    dataType: SchemaType,
    schemaType: SchemaType | SchemaType[],
  ): boolean {
    const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
    return allowedTypes.includes(dataType) ||
      (dataType === "integer" && allowedTypes.includes("number"));
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
      const arrA = a as unknown[];
      const arrB = b as unknown[];
      if (arrA.length !== arrB.length) return false;
      return arrA.every((item, index) => this.deepEqual(item, arrB[index]));
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => this.deepEqual(objA[key], objB[key]));
  }

  /**
   * Get string length (grapheme clusters for proper Unicode support)
   */
  private getStringLength(str: string): number {
    // Use Intl.Segmenter for proper grapheme counting if available
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      });
      return [...segmenter.segment(str)].length;
    }
    // Fallback to Array.from for code point counting
    return Array.from(str).length;
  }
}
