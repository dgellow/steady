/**
 * Runtime Validator - Fast validation using pre-processed schemas
 * 
 * Uses the pre-computed indexes and resolved references from the processor
 * to enable efficient validation without re-parsing or re-analyzing schemas.
 */

import type {
  ProcessedSchema,
  Schema,
  SchemaType,
  ValidationError,
  ValidationContext,
} from "./types.ts";

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
        // Update context for ref
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
      // Continue to process sibling keywords after $ref
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
      if (!schema.enum.some(value => this.deepEqual(data, value))) {
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
   * String validation
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
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push(this.createError(
            "pattern",
            `Must match pattern "${schema.pattern}"`,
            { ...context, schemaPath: `${context.schemaPath}/pattern` },
            { pattern: schema.pattern },
          ));
        }
      } catch {
        // Pattern error should be caught during schema processing
      }
    }
    
    // Format validation would go here if enabled
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
   * Array validation
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
    
    if (schema.uniqueItems === true) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (this.deepEqual(data[i], data[j])) {
            errors.push(this.createError(
              "uniqueItems",
              `Must NOT have duplicate items (items ## ${i} and ${j} are identical)`,
              { 
                ...context, 
                instancePath: `${context.instancePath}/${j}`,
                schemaPath: `${context.schemaPath}/uniqueItems`,
              },
              { i, j },
            ));
          }
        }
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
              instancePath: `${context.instancePath}/${propName}`,
              schemaPath: `${context.schemaPath}/properties/${propName}`,
            },
            errors,
          );
        }
      }
    }
    
    // Pattern properties
    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        const regex = new RegExp(pattern);
        for (const propName of keys) {
          if (regex.test(propName)) {
            context.evaluated.properties.add(propName);
            this.validateWithSchema(
              data[propName],
              patternSchema,
              {
                ...context,
                instancePath: `${context.instancePath}/${propName}`,
                schemaPath: `${context.schemaPath}/patternProperties/${pattern}`,
              },
              errors,
            );
          }
        }
      }
    }
    
    // Additional properties
    if (schema.additionalProperties !== undefined) {
      const additionalProps = keys.filter(key => !context.evaluated.properties.has(key));
      
      if (schema.additionalProperties === false && additionalProps.length > 0) {
        for (const prop of additionalProps) {
          errors.push(this.createError(
            "additionalProperties",
            `Must NOT have additional properties`,
            {
              ...context,
              instancePath: `${context.instancePath}/${prop}`,
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
              instancePath: `${context.instancePath}/${prop}`,
              schemaPath: `${context.schemaPath}/additionalProperties`,
            },
            errors,
          );
        }
      }
    }
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
      const subErrors: ValidationError[] = [];
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
        subErrors.push(...tempErrors);
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
        }
      }
      
      if (validCount !== 1) {
        errors.push(this.createError(
          "oneOf",
          `Must match exactly one schema in oneOf`,
          { ...context, schemaPath: `${context.schemaPath}/oneOf` },
          { passingSchemas: validCount },
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
    return schema || null;
  }
  
  /**
   * Get data at a specific path
   */
  private getDataAtPath(root: unknown, instancePath: string): unknown {
    if (!instancePath || instancePath === "") return root;
    
    const segments = instancePath.split("/").slice(1); // Remove leading empty segment
    let current = root;
    
    for (const segment of segments) {
      if (current === null || current === undefined) return undefined;
      
      if (typeof current === "object") {
        current = (current as any)[segment];
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
    return errors.map(error => {
      const enriched = { ...error };
      
      // Add source location if available
      if (this.schema.source.lineNumbers) {
        const lineInfo = this.schema.source.lineNumbers.get(error.schemaPath);
        if (lineInfo) {
          enriched.sourceLocation = {
            file: this.schema.source.file || "unknown",
            line: lineInfo.start,
            column: lineInfo.column || 0,
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
    return "object"; // fallback
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
    return keysA.every(key => this.deepEqual(objA[key], objB[key]));
  }
  
  /**
   * Get string length (grapheme clusters)
   */
  private getStringLength(str: string): number {
    // Simple implementation - in production would use Intl.Segmenter
    return Array.from(str).length;
  }
}