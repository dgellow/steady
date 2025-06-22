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

export class JsonSchemaValidator {
  private options: ValidatorOptions;

  constructor(options: ValidatorOptions = {}) {
    this.options = {
      dialect: "https://json-schema.org/draft/2020-12/schema",
      strict: true,
      validateFormats: true,
      allowUnknownFormats: false,
      ...options,
    };
  }

  validate(schema: Schema, data: unknown, path = ""): ValidationResult {
    const errors: ValidationError[] = [];
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
    // Handle $ref
    if (schema.$ref) {
      // For now, we don't resolve references - that's handled by the parser
      // In a full implementation, this would resolve the reference
      return;
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
      const seen = new Set();
      for (let i = 0; i < data.length; i++) {
        const item = JSON.stringify(data[i]);
        if (seen.has(item)) {
          errors.push({
            instancePath: `${instancePath}/${i}`,
            schemaPath: `${schemaPath}/uniqueItems`,
            keyword: "uniqueItems",
            message: `must NOT have duplicate items (items ## ${
              Array.from(seen).indexOf(item)
            } and ${i} are identical)`,
            params: { i, j: Array.from(seen).indexOf(item) },
            schema: true,
            data: data[i],
          });
        }
        seen.add(item);
      }
    }

    // Validate items
    if (schema.items && !Array.isArray(schema.items)) {
      data.forEach((item, index) => {
        this.validateInternal(
          schema.items as Schema,
          item,
          `${instancePath}/${index}`,
          `${schemaPath}/items`,
          errors,
        );
      });
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

    // Validate properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in data) {
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
      case "uri":
        isValid = this.isValidUri(data);
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
