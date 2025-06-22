/**
 * JSON Schema validator implementation
 * Focused on OpenAPI 3.1 use cases with JSON Schema 2020-12 support
 */

import type {
  Schema,
  SchemaType,
  ValidationError,
  ValidationResult,
  ValidatorOptions,
} from "./types.ts";
import { RefResolver } from "./ref-resolver.ts";

export class JsonSchemaValidator {
  private options: ValidatorOptions;
  private refResolver?: RefResolver;

  constructor(options: ValidatorOptions = {}) {
    this.options = {
      dialect: "https://json-schema.org/draft/2020-12/schema",
      strict: true,
      validateFormats: false, // Format validation is annotation-only by default in 2020-12
      allowUnknownFormats: true,
      ...options,
    };
  }

  validate(schema: Schema, data: unknown, path = ""): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Initialize reference resolver for this validation
    this.refResolver = new RefResolver(schema);
    
    this.validateInternal(schema, data, path, "#", errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateInternal(
    schema: Schema,
    data: unknown,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    // Handle boolean schemas
    if (typeof schema === "boolean") {
      if (!schema) {
        errors.push({
          instancePath,
          schemaPath,
          keyword: "false",
          message: "boolean schema false",
          params: {},
          schema: false,
          data,
        });
      }
      return;
    }

    // Handle $ref (but continue with sibling keywords after)
    if (schema.$ref) {
      if (!this.refResolver) {
        errors.push({
          instancePath,
          schemaPath,
          keyword: "$ref",
          message: "Reference resolver not initialized",
          params: { $ref: schema.$ref },
          schema: schema.$ref,
          data,
        });
        return;
      }

      const resolved = this.refResolver.resolve(schema.$ref);
      
      if (!resolved.resolved) {
        errors.push({
          instancePath,
          schemaPath,
          keyword: "$ref",
          message: resolved.error || `Failed to resolve reference: ${schema.$ref}`,
          params: { $ref: schema.$ref },
          schema: schema.$ref,
          data,
        });
        return;
      }

      // Validate against the resolved schema
      this.validateInternal(
        resolved.schema,
        data,
        instancePath,
        `${schemaPath}/$ref`,
        errors,
      );
      
      // Continue to validate sibling keywords - don't return here
    }

    // Handle undefined values - not valid JSON
    if (data === undefined) {
      errors.push({
        instancePath,
        schemaPath,
        keyword: "type",
        message: "value is undefined, which is not a valid JSON value",
        params: {},
        schema,
        data,
      });
      return;
    }

    // Const validation
    if (schema.const !== undefined) {
      if (!this.deepEqual(data, schema.const)) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/const`,
          keyword: "const",
          message: `must be equal to constant`,
          params: { allowedValue: schema.const },
          schema: schema.const,
          data,
        });
      }
    }

    // Enum validation
    if (schema.enum !== undefined) {
      if (!schema.enum.some((value) => this.deepEqual(data, value))) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/enum`,
          keyword: "enum",
          message: `must be equal to one of the allowed values`,
          params: { allowedValues: schema.enum },
          schema: schema.enum,
          data,
        });
      }
    }

    // Type-specific validation
    const dataType = this.getType(data);

    // If type is specified, validate it matches
    if (schema.type && !this.isTypeAllowed(dataType, schema.type)) {
      const allowedTypes = Array.isArray(schema.type)
        ? schema.type
        : [schema.type];
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/type`,
        keyword: "type",
        message: `must be ${allowedTypes.join(" or ")}`,
        params: { type: allowedTypes },
        schema: schema.type,
        data,
      });
    }

    // Apply type-specific validations based on actual data type
    // Per spec: "Most assertions only constrain values within a certain primitive type"
    switch (dataType) {
      case "string":
        this.validateString(
          schema,
          data as string,
          instancePath,
          schemaPath,
          errors,
        );
        break;
      case "number":
      case "integer":
        this.validateNumber(
          schema,
          data as number,
          instancePath,
          schemaPath,
          errors,
        );
        break;
      case "array":
        this.validateArray(
          schema,
          data as unknown[],
          instancePath,
          schemaPath,
          errors,
        );
        break;
      case "object":
        if (data !== null) {
          this.validateObject(
            schema,
            data as Record<string, unknown>,
            instancePath,
            schemaPath,
            errors,
          );
        }
        break;
    }

    // Composition validation
    this.validateComposition(schema, data, instancePath, schemaPath, errors);

    // Conditional validation
    this.validateConditional(schema, data, instancePath, schemaPath, errors);
  }

  private validateString(
    schema: Schema,
    data: string,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/minLength`,
        keyword: "minLength",
        message: `must NOT have fewer than ${schema.minLength} characters`,
        params: { limit: schema.minLength },
        schema: schema.minLength,
        data,
      });
    }

    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/maxLength`,
        keyword: "maxLength",
        message: `must NOT have more than ${schema.maxLength} characters`,
        params: { limit: schema.maxLength },
        schema: schema.maxLength,
        data,
      });
    }

    if (schema.pattern !== undefined) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/pattern`,
            keyword: "pattern",
            message: `must match pattern "${schema.pattern}"`,
            params: { pattern: schema.pattern },
            schema: schema.pattern,
            data,
          });
        }
      } catch (e) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/pattern`,
          keyword: "pattern",
          message: `invalid regex pattern: ${
            e instanceof Error ? e.message : String(e)
          }`,
          params: { pattern: schema.pattern },
          schema: schema.pattern,
          data,
        });
      }
    }

    if (schema.format !== undefined && this.options.validateFormats) {
      this.validateFormat(
        schema.format,
        data,
        instancePath,
        schemaPath,
        errors,
      );
    }
  }

  private validateNumber(
    schema: Schema,
    data: number,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/minimum`,
        keyword: "minimum",
        message: `must be >= ${schema.minimum}`,
        params: { comparison: ">=", limit: schema.minimum },
        schema: schema.minimum,
        data,
      });
    }

    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/maximum`,
        keyword: "maximum",
        message: `must be <= ${schema.maximum}`,
        params: { comparison: "<=", limit: schema.maximum },
        schema: schema.maximum,
        data,
      });
    }

    if (
      schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum
    ) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/exclusiveMinimum`,
        keyword: "exclusiveMinimum",
        message: `must be > ${schema.exclusiveMinimum}`,
        params: { comparison: ">", limit: schema.exclusiveMinimum },
        schema: schema.exclusiveMinimum,
        data,
      });
    }

    if (
      schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum
    ) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/exclusiveMaximum`,
        keyword: "exclusiveMaximum",
        message: `must be < ${schema.exclusiveMaximum}`,
        params: { comparison: "<", limit: schema.exclusiveMaximum },
        schema: schema.exclusiveMaximum,
        data,
      });
    }

    if (schema.multipleOf !== undefined && data % schema.multipleOf !== 0) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/multipleOf`,
        keyword: "multipleOf",
        message: `must be multiple of ${schema.multipleOf}`,
        params: { multipleOf: schema.multipleOf },
        schema: schema.multipleOf,
        data,
      });
    }
  }

  private validateArray(
    schema: Schema,
    data: unknown[],
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/minItems`,
        keyword: "minItems",
        message: `must NOT have fewer than ${schema.minItems} items`,
        params: { limit: schema.minItems },
        schema: schema.minItems,
        data,
      });
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/maxItems`,
        keyword: "maxItems",
        message: `must NOT have more than ${schema.maxItems} items`,
        params: { limit: schema.maxItems },
        schema: schema.maxItems,
        data,
      });
    }

    if (schema.uniqueItems === true) {
      // Use proper deep equality that ignores property order
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (this.deepEqual(data[i], data[j])) {
            errors.push({
              instancePath: `${instancePath}/${j}`,
              schemaPath: `${schemaPath}/uniqueItems`,
              keyword: "uniqueItems",
              message: `must NOT have duplicate items (items ## ${i} and ${j} are identical)`,
              params: { i, j },
              schema: true,
              data: data[j],
            });
          }
        }
      }
    }

    const evaluatedIndices = new Set<number>();

    // Validate prefixItems (tuple validation)
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
        evaluatedIndices.add(i);
        this.validateInternal(
          schema.prefixItems[i],
          data[i],
          `${instancePath}/${i}`,
          `${schemaPath}/prefixItems/${i}`,
          errors,
        );
      }
    }

    // Validate items (for remaining items after prefixItems)
    if (schema.items !== undefined) {
      const startIndex = schema.prefixItems ? schema.prefixItems.length : 0;
      for (let i = startIndex; i < data.length; i++) {
        evaluatedIndices.add(i);
        this.validateInternal(
          schema.items as Schema,
          data[i],
          `${instancePath}/${i}`,
          `${schemaPath}/items`,
          errors,
        );
      }
    }

    // Validate contains
    if (schema.contains) {
      const containsMatches: number[] = [];
      
      for (let i = 0; i < data.length; i++) {
        const containsErrors: ValidationError[] = [];
        this.validateInternal(
          schema.contains,
          data[i],
          `${instancePath}/${i}`,
          `${schemaPath}/contains`,
          containsErrors,
        );
        
        if (containsErrors.length === 0) {
          containsMatches.push(i);
          evaluatedIndices.add(i);
        }
      }

      // Check minContains/maxContains
      const numMatches = containsMatches.length;
      const minContains = schema.minContains ?? 1;
      
      if (numMatches < minContains) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/${schema.minContains !== undefined ? 'minContains' : 'contains'}`,
          keyword: schema.minContains !== undefined ? 'minContains' : 'contains',
          message: `must contain at least ${minContains} valid item(s)`,
          params: { minContains, contains: schema.contains },
          schema: schema.minContains ?? schema.contains,
          data,
        });
      }

      if (schema.maxContains !== undefined && numMatches > schema.maxContains) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/maxContains`,
          keyword: "maxContains",
          message: `must contain at most ${schema.maxContains} valid item(s)`,
          params: { maxContains: schema.maxContains },
          schema: schema.maxContains,
          data,
        });
      }
    }

    // Validate unevaluatedItems
    if (schema.unevaluatedItems !== undefined) {
      const unevaluatedIndices = data
        .map((_, index) => index)
        .filter(index => !evaluatedIndices.has(index));

      if (schema.unevaluatedItems === false && unevaluatedIndices.length > 0) {
        for (const index of unevaluatedIndices) {
          errors.push({
            instancePath: `${instancePath}/${index}`,
            schemaPath: `${schemaPath}/unevaluatedItems`,
            keyword: "unevaluatedItems",
            message: `must NOT have unevaluated items`,
            params: { unevaluatedItems: index },
            schema: false,
            data: data[index],
          });
        }
      } else if (typeof schema.unevaluatedItems === "object") {
        for (const index of unevaluatedIndices) {
          this.validateInternal(
            schema.unevaluatedItems,
            data[index],
            `${instancePath}/${index}`,
            `${schemaPath}/unevaluatedItems`,
            errors,
          );
        }
      }
    }
  }

  private validateObject(
    schema: Schema,
    data: Record<string, unknown>,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    const keys = Object.keys(data);

    if (
      schema.minProperties !== undefined && keys.length < schema.minProperties
    ) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/minProperties`,
        keyword: "minProperties",
        message: `must NOT have fewer than ${schema.minProperties} properties`,
        params: { limit: schema.minProperties },
        schema: schema.minProperties,
        data,
      });
    }

    if (
      schema.maxProperties !== undefined && keys.length > schema.maxProperties
    ) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/maxProperties`,
        keyword: "maxProperties",
        message: `must NOT have more than ${schema.maxProperties} properties`,
        params: { limit: schema.maxProperties },
        schema: schema.maxProperties,
        data,
      });
    }

    // Required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in data)) {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/required`,
            keyword: "required",
            message: `must have required property '${requiredProp}'`,
            params: { missingProperty: requiredProp },
            schema: schema.required,
            data,
          });
        }
      }
    }

    // Dependent required
    if (schema.dependentRequired) {
      for (const [prop, deps] of Object.entries(schema.dependentRequired)) {
        if (prop in data) {
          for (const dep of deps) {
            if (!(dep in data)) {
              errors.push({
                instancePath,
                schemaPath: `${schemaPath}/dependentRequired/${prop}`,
                keyword: "dependentRequired",
                message: `must have property '${dep}' when property '${prop}' is present`,
                params: { property: prop, missingProperty: dep, deps },
                schema: deps,
                data,
              });
            }
          }
        }
      }
    }

    // Dependent schemas
    if (schema.dependentSchemas) {
      for (const [prop, depSchema] of Object.entries(schema.dependentSchemas)) {
        if (prop in data) {
          this.validateInternal(
            depSchema,
            data,
            instancePath,
            `${schemaPath}/dependentSchemas/${prop}`,
            errors,
          );
        }
      }
    }

    const evaluatedProps = new Set<string>();

    // Validate properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in data) {
          evaluatedProps.add(propName);
          this.validateInternal(
            propSchema,
            data[propName],
            `${instancePath}/${propName}`,
            `${schemaPath}/properties/${propName}`,
            errors,
          );
        }
      }
    }

    // Pattern properties
    if (schema.patternProperties) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern);
        } catch {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/patternProperties/${pattern}`,
            keyword: "patternProperties",
            message: `invalid regular expression: ${pattern}`,
            params: { pattern },
            schema: pattern,
            data,
          });
          continue;
        }

        for (const propName of keys) {
          if (regex.test(propName)) {
            evaluatedProps.add(propName);
            this.validateInternal(
              patternSchema,
              data[propName],
              `${instancePath}/${propName}`,
              `${schemaPath}/patternProperties/${pattern}`,
              errors,
            );
          }
        }
      }
    }

    // Additional properties
    if (schema.additionalProperties !== undefined) {
      const additionalProps = keys.filter(key => !evaluatedProps.has(key));
      
      if (schema.additionalProperties === false && additionalProps.length > 0) {
        for (const prop of additionalProps) {
          errors.push({
            instancePath: `${instancePath}/${prop}`,
            schemaPath: `${schemaPath}/additionalProperties`,
            keyword: "additionalProperties",
            message: `must NOT have additional properties`,
            params: { additionalProperty: prop },
            schema: false,
            data: data[prop],
          });
        }
      } else if (typeof schema.additionalProperties === "object") {
        for (const prop of additionalProps) {
          this.validateInternal(
            schema.additionalProperties,
            data[prop],
            `${instancePath}/${prop}`,
            `${schemaPath}/additionalProperties`,
            errors,
          );
        }
      }
    }

    // Property names validation
    if (schema.propertyNames) {
      for (const propName of keys) {
        const propNameErrors: ValidationError[] = [];
        this.validateInternal(
          schema.propertyNames,
          propName,
          instancePath,
          `${schemaPath}/propertyNames`,
          propNameErrors,
        );
        
        if (propNameErrors.length > 0) {
          errors.push({
            instancePath: `${instancePath}/${propName}`,
            schemaPath: `${schemaPath}/propertyNames`,
            keyword: "propertyNames",
            message: `property name '${propName}' is invalid`,
            params: { propertyName: propName },
            schema: schema.propertyNames,
            data: propName,
          });
        }
      }
    }

    // Unevaluated properties (simplified implementation)
    if (schema.unevaluatedProperties !== undefined) {
      // Note: Full implementation requires tracking evaluated properties
      // across allOf, anyOf, oneOf, if/then/else which is complex
      // This is a simplified version for now
      const unevaluatedProps = keys.filter(key => !evaluatedProps.has(key));
      
      if (schema.unevaluatedProperties === false && unevaluatedProps.length > 0) {
        for (const prop of unevaluatedProps) {
          errors.push({
            instancePath: `${instancePath}/${prop}`,
            schemaPath: `${schemaPath}/unevaluatedProperties`,
            keyword: "unevaluatedProperties",
            message: `must NOT have unevaluated properties`,
            params: { unevaluatedProperty: prop },
            schema: false,
            data: data[prop],
          });
        }
      } else if (typeof schema.unevaluatedProperties === "object") {
        for (const prop of unevaluatedProps) {
          this.validateInternal(
            schema.unevaluatedProperties,
            data[prop],
            `${instancePath}/${prop}`,
            `${schemaPath}/unevaluatedProperties`,
            errors,
          );
        }
      }
    }
  }

  private validateComposition(
    schema: Schema,
    data: unknown,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    if (schema.allOf) {
      schema.allOf.forEach((subSchema, index) => {
        this.validateInternal(
          subSchema,
          data,
          instancePath,
          `${schemaPath}/allOf/${index}`,
          errors,
        );
      });
    }

    if (schema.anyOf) {
      const anyOfErrors: ValidationError[] = [];
      let anyValid = false;

      for (let i = 0; i < schema.anyOf.length; i++) {
        const subErrors: ValidationError[] = [];
        this.validateInternal(
          schema.anyOf[i]!,
          data,
          instancePath,
          `${schemaPath}/anyOf/${i}`,
          subErrors,
        );
        if (subErrors.length === 0) {
          anyValid = true;
          break;
        }
        anyOfErrors.push(...subErrors);
      }

      if (!anyValid) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/anyOf`,
          keyword: "anyOf",
          message: `must match at least one schema in anyOf`,
          params: {},
          schema: schema.anyOf,
          data,
        });
      }
    }

    if (schema.oneOf) {
      let validCount = 0;

      for (let i = 0; i < schema.oneOf.length; i++) {
        const subErrors: ValidationError[] = [];
        this.validateInternal(
          schema.oneOf[i]!,
          data,
          instancePath,
          `${schemaPath}/oneOf/${i}`,
          subErrors,
        );
        if (subErrors.length === 0) {
          validCount++;
        }
      }

      if (validCount !== 1) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/oneOf`,
          keyword: "oneOf",
          message: `must match exactly one schema in oneOf`,
          params: { passingSchemas: validCount },
          schema: schema.oneOf,
          data,
        });
      }
    }

    if (schema.not) {
      const notErrors: ValidationError[] = [];
      this.validateInternal(
        schema.not,
        data,
        instancePath,
        `${schemaPath}/not`,
        notErrors,
      );
      if (notErrors.length === 0) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/not`,
          keyword: "not",
          message: `must NOT be valid`,
          params: {},
          schema: schema.not,
          data,
        });
      }
    }
  }

  private validateConditional(
    schema: Schema,
    data: unknown,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    if (schema.if) {
      const ifErrors: ValidationError[] = [];
      this.validateInternal(
        schema.if,
        data,
        instancePath,
        `${schemaPath}/if`,
        ifErrors,
      );

      if (ifErrors.length === 0 && schema.then) {
        // If condition is true, validate then
        this.validateInternal(
          schema.then,
          data,
          instancePath,
          `${schemaPath}/then`,
          errors,
        );
      } else if (ifErrors.length > 0 && schema.else) {
        // If condition is false, validate else
        this.validateInternal(
          schema.else,
          data,
          instancePath,
          `${schemaPath}/else`,
          errors,
        );
      }
    }
  }

  private validateFormat(
    format: string,
    data: string,
    instancePath: string,
    schemaPath: string,
    errors: ValidationError[],
  ): void {
    let isValid = false;

    switch (format) {
      case "email":
        isValid = this.isValidEmail(data);
        break;
      case "idn-email":
        isValid = this.isValidIdnEmail(data);
        break;
      case "hostname":
        isValid = this.isValidHostname(data);
        break;
      case "idn-hostname":
        isValid = this.isValidIdnHostname(data);
        break;
      case "ipv4":
        isValid = this.isValidIpv4(data);
        break;
      case "ipv6":
        isValid = this.isValidIpv6(data);
        break;
      case "uri":
        isValid = this.isValidUri(data);
        break;
      case "uri-reference":
        isValid = this.isValidUriReference(data);
        break;
      case "iri":
        isValid = this.isValidIri(data);
        break;
      case "iri-reference":
        isValid = this.isValidIriReference(data);
        break;
      case "uri-template":
        isValid = this.isValidUriTemplate(data);
        break;
      case "json-pointer":
        isValid = this.isValidJsonPointer(data);
        break;
      case "relative-json-pointer":
        isValid = this.isValidRelativeJsonPointer(data);
        break;
      case "regex":
        isValid = this.isValidRegex(data);
        break;
      case "date-time":
        isValid = this.isValidDateTime(data);
        break;
      case "date":
        isValid = this.isValidDate(data);
        break;
      case "time":
        isValid = this.isValidTime(data);
        break;
      case "duration":
        isValid = this.isValidDuration(data);
        break;
      case "uuid":
        isValid = this.isValidUuid(data);
        break;
      default:
        if (!this.options.allowUnknownFormats) {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/format`,
            keyword: "format",
            message: `unknown format "${format}"`,
            params: { format },
            schema: format,
            data,
          });
        }
        return;
    }

    if (!isValid) {
      errors.push({
        instancePath,
        schemaPath: `${schemaPath}/format`,
        keyword: "format",
        message: `must match format "${format}"`,
        params: { format },
        schema: format,
        data,
      });
    }
  }

  private isValidEmail(email: string): boolean {
    // Basic email validation - must have exactly one @ with non-empty parts before and after
    const atIndex = email.indexOf("@");
    if (atIndex <= 0 || atIndex === email.length - 1) return false;
    if (email.indexOf("@", atIndex + 1) !== -1) return false; // Multiple @

    const local = email.substring(0, atIndex);
    const domain = email.substring(atIndex + 1);

    // Basic checks
    if (local.length === 0 || domain.length === 0) return false;
    if (domain.indexOf(".") === -1) return false; // Domain must have a dot
    if (email.includes(" ")) return false; // No spaces

    return true;
  }

  private isValidUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  private isValidDateTime(dateTime: string): boolean {
    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm:ss+HH:mm
    try {
      const date = new Date(dateTime);
      if (isNaN(date.getTime())) return false;

      // Check basic format structure
      if (!dateTime.includes("T")) return false;
      const parts = dateTime.split("T");
      if (parts.length !== 2) return false;

      const datePart = parts[0];
      const timePart = parts[1];

      if (!datePart || !timePart) return false;
      return this.isValidDate(datePart) && timePart.length >= 8; // At least HH:mm:ss
    } catch {
      return false;
    }
  }

  private isValidDate(date: string): boolean {
    // YYYY-MM-DD format
    if (date.length !== 10) return false;
    if (date[4] !== "-" || date[7] !== "-") return false;

    const year = parseInt(date.substring(0, 4), 10);
    const month = parseInt(date.substring(5, 7), 10);
    const day = parseInt(date.substring(8, 10), 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
    if (year < 1000 || year > 9999) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // Check if date is actually valid (handles leap years, etc.)
    const testDate = new Date(year, month - 1, day);
    return testDate.getFullYear() === year &&
      testDate.getMonth() === month - 1 &&
      testDate.getDate() === day;
  }

  private isValidTime(time: string): boolean {
    // HH:mm:ss format
    if (time.length !== 8) return false;
    if (time[2] !== ":" || time[5] !== ":") return false;

    const hours = parseInt(time.substring(0, 2), 10);
    const minutes = parseInt(time.substring(3, 5), 10);
    const seconds = parseInt(time.substring(6, 8), 10);

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return false;
    if (hours < 0 || hours > 23) return false;
    if (minutes < 0 || minutes > 59) return false;
    if (seconds < 0 || seconds > 59) return false;

    return true;
  }

  private isValidUuid(uuid: string): boolean {
    // UUID format: 8-4-4-4-12 hex characters
    if (uuid.length !== 36) return false;
    if (
      uuid[8] !== "-" || uuid[13] !== "-" || uuid[18] !== "-" ||
      uuid[23] !== "-"
    ) return false;

    const parts = uuid.split("-");
    if (parts.length !== 5) return false;

    const part0 = parts[0];
    const part1 = parts[1];
    const part2 = parts[2];
    const part3 = parts[3];
    const part4 = parts[4];

    if (!part0 || !part1 || !part2 || !part3 || !part4) return false;
    if (
      part0.length !== 8 || part1.length !== 4 || part2.length !== 4 ||
      part3.length !== 4 || part4.length !== 12
    ) return false;

    // Check all parts are valid hex
    for (const part of parts) {
      for (let i = 0; i < part.length; i++) {
        const char = part[i];
        if (!char) return false;
        if (
          !((char >= "0" && char <= "9") ||
            (char >= "a" && char <= "f") ||
            (char >= "A" && char <= "F"))
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private isValidIdnEmail(email: string): boolean {
    // For now, treat IDN email same as regular email
    // Full IDN support would require Unicode normalization
    return this.isValidEmail(email);
  }

  private isValidHostname(hostname: string): boolean {
    if (hostname.length === 0 || hostname.length > 253) return false;
    if (hostname.endsWith(".")) {
      hostname = hostname.slice(0, -1);
    }
    
    const labels = hostname.split(".");
    for (const label of labels) {
      if (label.length === 0 || label.length > 63) return false;
      if (label.startsWith("-") || label.endsWith("-")) return false;
      if (!/^[a-zA-Z0-9-]+$/.test(label)) return false;
    }
    
    return true;
  }

  private isValidIdnHostname(hostname: string): boolean {
    // For now, treat IDN hostname same as regular hostname
    // Full IDN support would require Unicode normalization
    return this.isValidHostname(hostname);
  }

  private isValidIpv4(ip: string): boolean {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    
    for (const part of parts) {
      if (part.length === 0) return false;
      if (part.length > 1 && part.startsWith("0")) return false; // No leading zeros
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) return false;
      if (num.toString() !== part) return false; // Ensure no extra characters
    }
    
    return true;
  }

  private isValidIpv6(ip: string): boolean {
    // Basic IPv6 validation - handles most common cases
    if (ip.includes("::")) {
      const parts = ip.split("::");
      if (parts.length !== 2) return false;
      
      const left = parts[0] ? parts[0].split(":") : [];
      const right = parts[1] ? parts[1].split(":") : [];
      
      if (left.length + right.length > 6) return false;
      
      for (const part of [...left, ...right]) {
        if (part.length === 0) continue;
        if (part.length > 4) return false;
        if (!/^[0-9a-fA-F]+$/.test(part)) return false;
      }
    } else {
      const parts = ip.split(":");
      if (parts.length !== 8) return false;
      
      for (const part of parts) {
        if (part.length === 0 || part.length > 4) return false;
        if (!/^[0-9a-fA-F]+$/.test(part)) return false;
      }
    }
    
    return true;
  }

  private isValidUriReference(uri: string): boolean {
    // URI reference can be absolute URI or relative reference
    if (uri.length === 0) return true; // Empty string is valid relative reference
    
    try {
      // Try as absolute URI
      new URL(uri);
      return true;
    } catch {
      // Check as relative reference - basic validation
      return !/[\x00-\x20\x7f-\xff]/.test(uri);
    }
  }

  private isValidIri(iri: string): boolean {
    // For now, treat IRI same as URI
    // Full IRI support would require Unicode character validation
    return this.isValidUri(iri);
  }

  private isValidIriReference(iri: string): boolean {
    // For now, treat IRI reference same as URI reference
    return this.isValidUriReference(iri);
  }

  private isValidUriTemplate(template: string): boolean {
    // Basic URI template validation (RFC 6570)
    // Check for properly formed expressions
    let braceDepth = 0;
    for (let i = 0; i < template.length; i++) {
      const char = template[i];
      if (char === "{") {
        braceDepth++;
        if (braceDepth > 1) return false; // No nested braces
      } else if (char === "}") {
        braceDepth--;
        if (braceDepth < 0) return false; // Unmatched closing brace
      }
    }
    return braceDepth === 0; // All braces must be matched
  }

  private isValidJsonPointer(pointer: string): boolean {
    // JSON Pointer must start with "/" or be empty
    if (pointer === "") return true;
    if (!pointer.startsWith("/")) return false;
    
    // Check for proper escaping
    const segments = pointer.split("/").slice(1);
    for (const segment of segments) {
      // Check for unescaped ~ that's not ~0 or ~1
      for (let i = 0; i < segment.length; i++) {
        if (segment[i] === "~") {
          if (i === segment.length - 1) return false; // ~ at end
          const next = segment[i + 1];
          if (next !== "0" && next !== "1") return false; // Invalid escape
        }
      }
    }
    
    return true;
  }

  private isValidRelativeJsonPointer(pointer: string): boolean {
    // Relative JSON Pointer starts with non-negative integer
    if (pointer.length === 0) return false;
    
    let i = 0;
    // Parse non-negative integer
    if (pointer[0] === "0") {
      i = 1;
    } else if (pointer[0] >= "1" && pointer[0] <= "9") {
      i = 1;
      while (i < pointer.length && pointer[i] >= "0" && pointer[i] <= "9") {
        i++;
      }
    } else {
      return false;
    }
    
    // Rest must be empty or valid JSON pointer
    const rest = pointer.slice(i);
    return rest === "" || rest === "#" || this.isValidJsonPointer(rest);
  }

  private isValidRegex(pattern: string): boolean {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }

  private isValidDuration(duration: string): boolean {
    // ISO 8601 duration format: P[n]Y[n]M[n]DT[n]H[n]M[n]S
    if (!duration.startsWith("P")) return false;
    
    const regex = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
    const match = duration.match(regex);
    
    if (!match) return false;
    
    // Must have at least one component
    const hasDateComponent = match[1] || match[2] || match[3];
    const hasTimeComponent = match[4] || match[5] || match[6];
    
    if (duration.includes("T")) {
      // If T is present, must have time component
      return hasTimeComponent;
    }
    
    return hasDateComponent || hasTimeComponent;
  }

  private getType(data: unknown): SchemaType {
    if (data === null) return "null";
    if (typeof data === "boolean") return "boolean";
    if (typeof data === "string") return "string";
    if (typeof data === "number") {
      return Number.isInteger(data) ? "integer" : "number";
    }
    if (Array.isArray(data)) return "array";
    if (typeof data === "object") return "object";
    // undefined doesn't match any JSON Schema type
    return "object"; // fallback for undefined and other edge cases
  }

  private isTypeAllowed(
    dataType: SchemaType,
    schemaType: SchemaType | SchemaType[],
  ): boolean {
    const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
    return allowedTypes.includes(dataType) ||
      (dataType === "integer" && allowedTypes.includes("number"));
  }

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
}
