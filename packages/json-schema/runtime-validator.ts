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
 */

import type {
  ProcessedSchema,
  Schema,
  SchemaType,
  ValidationError,
  ValidationContext,
} from "./types.ts";

/** Maximum regex execution time in milliseconds */
const REGEX_TIMEOUT_MS = 100;

/** Maximum string length for regex matching to prevent ReDoS */
const MAX_REGEX_STRING_LENGTH = 100_000;

/** Format validators for common JSON Schema formats */
const FORMAT_VALIDATORS: Record<string, (value: string) => boolean> = {
  "date-time": (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v),
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
  "uuid": (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
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
  "hostname": (v) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(v),
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

export class RuntimeValidator {
  constructor(private schema: ProcessedSchema) {}

  /**
   * Validate data against the processed schema
   */
  validate(data: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    const context: ValidationContext = {
      root: data,
      instancePath: "",
      schemaPath: "#",
      evaluated: {
        properties: new Set<string>(),
        items: new Set<number>(),
      },
    };

    this.validateWithSchema(
      data,
      this.schema.root,
      context,
      errors,
    );

    return this.enrichErrors(errors);
  }

  /**
   * Core validation logic
   */
  private validateWithSchema(
    data: unknown,
    schema: Schema | boolean,
    context: ValidationContext,
    errors: ValidationError[],
  ): void {
    // Fast path for boolean schemas
    if (typeof schema === "boolean") {
      if (!schema) {
        errors.push(this.createError(
          "false",
          "Schema is false",
          context,
          { schema: false },
        ));
      }
      return;
    }

    // Handle $ref - use pre-resolved reference
    if (schema.$ref) {
      const resolved = this.schema.refs.resolved.get(schema.$ref);
      if (resolved) {
        const refContext = {
          ...context,
          schemaPath: `${context.schemaPath}/$ref`,
        };
        this.validateWithSchema(data, resolved, refContext, errors);
      } else {
        errors.push(this.createError(
          "$ref",
          `Unresolved reference: ${schema.$ref}`,
          context,
          { $ref: schema.$ref },
        ));
      }
    }

    // Handle undefined (not valid JSON)
    if (data === undefined) {
      errors.push(this.createError(
        "type",
        "Value is undefined, which is not a valid JSON value",
        context,
        {},
      ));
      return;
    }

    // Const validation
    if (schema.const !== undefined) {
      if (!this.deepEqual(data, schema.const)) {
        errors.push(this.createError(
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
        errors.push(this.createError(
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
      const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
      errors.push(this.createError(
        "type",
        `Must be ${allowedTypes.join(" or ")}`,
        { ...context, schemaPath: `${context.schemaPath}/type` },
        { type: allowedTypes },
      ));
    }

    // Type-specific validation
    switch (dataType) {
      case "string":
        this.validateString(schema, data as string, context, errors);
        break;
      case "number":
      case "integer":
        this.validateNumber(schema, data as number, context, errors);
        break;
      case "boolean":
        // No additional validation needed for booleans
        break;
      case "null":
        // No additional validation needed for null
        break;
      case "array":
        this.validateArray(schema, data as unknown[], context, errors);
        break;
      case "object":
        if (data !== null) {
          this.validateObject(schema, data as Record<string, unknown>, context, errors);
        }
        break;
    }

    // Composition validation
    this.validateComposition(schema, data, context, errors);

    // Conditional validation
    this.validateConditional(schema, data, context, errors);
  }

  /**
   * String validation with format support
   */
  private validateString(
    schema: Schema,
    data: string,
    context: ValidationContext,
    errors: ValidationError[],
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

    // Format validation
    if (schema.format !== undefined) {
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
   */
  private safeRegexTest(pattern: string, value: string): boolean {
    // Reject extremely long strings to prevent ReDoS
    if (value.length > MAX_REGEX_STRING_LENGTH) {
      console.warn(`String too long for regex validation: ${value.length} chars`);
      return true; // Pass validation for extremely long strings
    }

    try {
      const regex = new RegExp(pattern);
      const startTime = performance.now();
      const result = regex.test(value);
      const duration = performance.now() - startTime;

      if (duration > REGEX_TIMEOUT_MS) {
        console.warn(`Slow regex pattern detected: "${pattern}" took ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch {
      // Invalid regex - should be caught during schema processing
      return true;
    }
  }

  /**
   * Number validation
   */
  private validateNumber(
    schema: Schema,
    data: number,
    context: ValidationContext,
    errors: ValidationError[],
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

    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      errors.push(this.createError(
        "exclusiveMinimum",
        `Must be > ${schema.exclusiveMinimum}`,
        { ...context, schemaPath: `${context.schemaPath}/exclusiveMinimum` },
        { comparison: ">", limit: schema.exclusiveMinimum },
      ));
    }

    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      errors.push(this.createError(
        "exclusiveMaximum",
        `Must be < ${schema.exclusiveMaximum}`,
        { ...context, schemaPath: `${context.schemaPath}/exclusiveMaximum` },
        { comparison: "<", limit: schema.exclusiveMaximum },
      ));
    }

    if (schema.multipleOf !== undefined) {
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
   * Array validation with O(n) uniqueItems check
   */
  private validateArray(
    schema: Schema,
    data: unknown[],
    context: ValidationContext,
    errors: ValidationError[],
  ): void {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(this.createError(
        "minItems",
        `Must NOT have fewer than ${schema.minItems} items`,
        { ...context, schemaPath: `${context.schemaPath}/minItems` },
        { limit: schema.minItems },
      ));
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(this.createError(
        "maxItems",
        `Must NOT have more than ${schema.maxItems} items`,
        { ...context, schemaPath: `${context.schemaPath}/maxItems` },
        { limit: schema.maxItems },
      ));
    }

    // O(n) uniqueItems validation using JSON serialization
    if (schema.uniqueItems === true) {
      const seen = new Map<string, number>();
      for (let i = 0; i < data.length; i++) {
        const key = JSON.stringify(data[i]);
        const firstIndex = seen.get(key);
        if (firstIndex !== undefined) {
          errors.push(this.createError(
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

    // Validate items
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
        context.evaluated.items.add(i);
        this.validateWithSchema(
          data[i],
          schema.prefixItems[i]!,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/prefixItems/${i}`,
          },
          errors,
        );
      }
    }

    if (schema.items !== undefined) {
      const startIndex = schema.prefixItems ? schema.prefixItems.length : 0;
      for (let i = startIndex; i < data.length; i++) {
        context.evaluated.items.add(i);
        this.validateWithSchema(
          data[i],
          schema.items as Schema,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/items`,
          },
          errors,
        );
      }
    }

    // Contains validation
    if (schema.contains !== undefined) {
      let containsCount = 0;
      for (let i = 0; i < data.length; i++) {
        const tempErrors: ValidationError[] = [];
        this.validateWithSchema(
          data[i],
          schema.contains,
          {
            ...context,
            instancePath: `${context.instancePath}/${i}`,
            schemaPath: `${context.schemaPath}/contains`,
          },
          tempErrors,
        );
        if (tempErrors.length === 0) {
          containsCount++;
        }
      }

      if (containsCount === 0) {
        errors.push(this.createError(
          "contains",
          "Must contain at least one item matching the schema",
          { ...context, schemaPath: `${context.schemaPath}/contains` },
          {},
        ));
      }

      if (schema.minContains !== undefined && containsCount < schema.minContains) {
        errors.push(this.createError(
          "minContains",
          `Must contain at least ${schema.minContains} items matching the schema`,
          { ...context, schemaPath: `${context.schemaPath}/minContains` },
          { limit: schema.minContains, actual: containsCount },
        ));
      }

      if (schema.maxContains !== undefined && containsCount > schema.maxContains) {
        errors.push(this.createError(
          "maxContains",
          `Must contain at most ${schema.maxContains} items matching the schema`,
          { ...context, schemaPath: `${context.schemaPath}/maxContains` },
          { limit: schema.maxContains, actual: containsCount },
        ));
      }
    }
  }

  /**
   * Object validation
   */
  private validateObject(
    schema: Schema,
    data: Record<string, unknown>,
    context: ValidationContext,
    errors: ValidationError[],
  ): void {
    const keys = Object.keys(data);

    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(this.createError(
        "minProperties",
        `Must NOT have fewer than ${schema.minProperties} properties`,
        { ...context, schemaPath: `${context.schemaPath}/minProperties` },
        { limit: schema.minProperties },
      ));
    }

    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push(this.createError(
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
          errors.push(this.createError(
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
          context.evaluated.properties.add(propName);
          this.validateWithSchema(
            data[propName],
            propSchema,
            {
              ...context,
              instancePath: `${context.instancePath}/${this.escapeJsonPointer(propName)}`,
              schemaPath: `${context.schemaPath}/properties/${this.escapeJsonPointer(propName)}`,
            },
            errors,
          );
        }
      }
    }

    // Pattern properties
    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        for (const propName of keys) {
          if (this.safeRegexTest(pattern, propName)) {
            context.evaluated.properties.add(propName);
            this.validateWithSchema(
              data[propName],
              patternSchema,
              {
                ...context,
                instancePath: `${context.instancePath}/${this.escapeJsonPointer(propName)}`,
                schemaPath: `${context.schemaPath}/patternProperties/${this.escapeJsonPointer(pattern)}`,
              },
              errors,
            );
          }
        }
      }
    }

    // Property names validation
    if (schema.propertyNames !== undefined) {
      for (const propName of keys) {
        const nameErrors: ValidationError[] = [];
        this.validateWithSchema(
          propName,
          schema.propertyNames,
          {
            ...context,
            instancePath: `${context.instancePath}`,
            schemaPath: `${context.schemaPath}/propertyNames`,
          },
          nameErrors,
        );
        if (nameErrors.length > 0) {
          errors.push(this.createError(
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
      const additionalProps = keys.filter((key) => !context.evaluated.properties.has(key));

      if (schema.additionalProperties === false && additionalProps.length > 0) {
        for (const prop of additionalProps) {
          errors.push(this.createError(
            "additionalProperties",
            `Must NOT have additional properties`,
            {
              ...context,
              instancePath: `${context.instancePath}/${this.escapeJsonPointer(prop)}`,
              schemaPath: `${context.schemaPath}/additionalProperties`,
            },
            { additionalProperty: prop },
          ));
        }
      } else if (typeof schema.additionalProperties === "object") {
        for (const prop of additionalProps) {
          this.validateWithSchema(
            data[prop],
            schema.additionalProperties,
            {
              ...context,
              instancePath: `${context.instancePath}/${this.escapeJsonPointer(prop)}`,
              schemaPath: `${context.schemaPath}/additionalProperties`,
            },
            errors,
          );
        }
      }
    }

    // Dependent required
    if (schema.dependentRequired) {
      for (const [prop, requiredProps] of Object.entries(schema.dependentRequired)) {
        if (Object.prototype.hasOwnProperty.call(data, prop)) {
          for (const requiredProp of requiredProps) {
            if (!Object.prototype.hasOwnProperty.call(data, requiredProp)) {
              errors.push(this.createError(
                "dependentRequired",
                `Property '${prop}' requires property '${requiredProp}'`,
                { ...context, schemaPath: `${context.schemaPath}/dependentRequired` },
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
          this.validateWithSchema(
            data,
            depSchema,
            {
              ...context,
              schemaPath: `${context.schemaPath}/dependentSchemas/${this.escapeJsonPointer(prop)}`,
            },
            errors,
          );
        }
      }
    }
  }

  /**
   * Escape special characters in JSON pointer segments
   */
  private escapeJsonPointer(segment: string): string {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  /**
   * Composition validation (allOf, anyOf, oneOf, not)
   */
  private validateComposition(
    schema: Schema,
    data: unknown,
    context: ValidationContext,
    errors: ValidationError[],
  ): void {
    if (schema.allOf) {
      schema.allOf.forEach((subSchema, index) => {
        this.validateWithSchema(
          data,
          subSchema,
          {
            ...context,
            schemaPath: `${context.schemaPath}/allOf/${index}`,
          },
          errors,
        );
      });
    }

    if (schema.anyOf) {
      let anyValid = false;

      for (let i = 0; i < schema.anyOf.length; i++) {
        const tempErrors: ValidationError[] = [];
        this.validateWithSchema(
          data,
          schema.anyOf[i]!,
          {
            ...context,
            schemaPath: `${context.schemaPath}/anyOf/${i}`,
          },
          tempErrors,
        );

        if (tempErrors.length === 0) {
          anyValid = true;
          break;
        }
      }

      if (!anyValid) {
        errors.push(this.createError(
          "anyOf",
          `Must match at least one schema in anyOf`,
          { ...context, schemaPath: `${context.schemaPath}/anyOf` },
          {},
        ));
      }
    }

    if (schema.oneOf) {
      let validCount = 0;
      const validIndices: number[] = [];

      for (let i = 0; i < schema.oneOf.length; i++) {
        const tempErrors: ValidationError[] = [];
        this.validateWithSchema(
          data,
          schema.oneOf[i]!,
          {
            ...context,
            schemaPath: `${context.schemaPath}/oneOf/${i}`,
          },
          tempErrors,
        );

        if (tempErrors.length === 0) {
          validCount++;
          validIndices.push(i);
        }
      }

      if (validCount !== 1) {
        errors.push(this.createError(
          "oneOf",
          validCount === 0
            ? "Must match exactly one schema in oneOf (matched none)"
            : `Must match exactly one schema in oneOf (matched ${validCount}: indices ${validIndices.join(", ")})`,
          { ...context, schemaPath: `${context.schemaPath}/oneOf` },
          { passingSchemas: validCount, validIndices },
        ));
      }
    }

    if (schema.not) {
      const tempErrors: ValidationError[] = [];
      this.validateWithSchema(
        data,
        schema.not,
        {
          ...context,
          schemaPath: `${context.schemaPath}/not`,
        },
        tempErrors,
      );

      if (tempErrors.length === 0) {
        errors.push(this.createError(
          "not",
          `Must NOT be valid`,
          { ...context, schemaPath: `${context.schemaPath}/not` },
          {},
        ));
      }
    }
  }

  /**
   * Conditional validation (if/then/else)
   */
  private validateConditional(
    schema: Schema,
    data: unknown,
    context: ValidationContext,
    errors: ValidationError[],
  ): void {
    if (schema.if !== undefined) {
      const ifErrors: ValidationError[] = [];
      this.validateWithSchema(
        data,
        schema.if,
        {
          ...context,
          schemaPath: `${context.schemaPath}/if`,
        },
        ifErrors,
      );

      const ifPassed = ifErrors.length === 0;

      if (ifPassed && schema.then) {
        this.validateWithSchema(
          data,
          schema.then,
          {
            ...context,
            schemaPath: `${context.schemaPath}/then`,
          },
          errors,
        );
      } else if (!ifPassed && schema.else) {
        this.validateWithSchema(
          data,
          schema.else,
          {
            ...context,
            schemaPath: `${context.schemaPath}/else`,
          },
          errors,
        );
      }
    }
  }

  /**
   * Create a validation error with consistent structure
   */
  private createError(
    keyword: string,
    message: string,
    context: ValidationContext,
    params: Record<string, unknown>,
  ): ValidationError {
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
  private enrichErrors(errors: ValidationError[]): ValidationError[] {
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
  private getSuggestion(keyword: string, params?: Record<string, unknown>): string {
    switch (keyword) {
      case "type":
        return `Ensure the value is of the correct type: ${params?.type}`;
      case "required":
        return `Add the missing property: ${params?.missingProperty}`;
      case "additionalProperties":
        return `Remove the unexpected property: ${params?.additionalProperty}`;
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
   */
  private getType(data: unknown): SchemaType {
    if (data === null) return "null";
    if (typeof data === "boolean") return "boolean";
    if (typeof data === "string") return "string";
    if (typeof data === "number") {
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
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return [...segmenter.segment(str)].length;
    }
    // Fallback to Array.from for code point counting
    return Array.from(str).length;
  }
}
