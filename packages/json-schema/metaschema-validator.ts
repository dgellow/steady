/**
 * Metaschema Validator - Validates JSON Schemas against the JSON Schema metaschema
 * 
 * This ensures that schemas themselves are valid before we use them to validate data.
 * Critical for providing clear error messages when schemas are malformed.
 */

import type { ValidationResult, ValidationError, Schema } from "./types.ts";
import { JsonSchemaValidator } from "./validator_legacy.ts";

export class MetaschemaValidator {
  private validator: JsonSchemaValidator;
  
  constructor() {
    // Create a validator with the metaschema
    this.validator = new JsonSchemaValidator({
      dialect: "https://json-schema.org/draft/2020-12/schema",
      strict: true,
      validateFormats: true,
    });
  }
  
  /**
   * Validate a schema against the JSON Schema metaschema
   */
  validate(schemaObject: unknown, metaschema: Schema): ValidationResult {
    // First, check if it's a valid JSON value
    if (schemaObject === undefined) {
      return {
        valid: false,
        errors: [{
          instancePath: "",
          schemaPath: "",
          keyword: "type",
          message: "Schema must be a valid JSON value (not undefined)",
          suggestion: "Ensure the schema is properly loaded and parsed",
        }],
      };
    }
    
    // Validate against metaschema
    const result = this.validator.validate(metaschema, schemaObject);
    
    // Enhance errors with better messages for common issues
    if (!result.valid) {
      result.errors = this.enhanceErrors(result.errors);
    }
    
    // Additional semantic validation
    const semanticErrors = this.validateSemantics(schemaObject);
    if (semanticErrors.length > 0) {
      result.valid = false;
      result.errors.push(...semanticErrors);
    }
    
    return result;
  }
  
  /**
   * Enhance error messages with schema-specific context
   */
  private enhanceErrors(errors: ValidationError[]): ValidationError[] {
    return errors.map(error => {
      const enhanced = { ...error };
      
      // Add suggestions based on common mistakes
      switch (error.keyword) {
        case "type":
          if (error.instancePath.endsWith("/type")) {
            enhanced.message = "Invalid type value in schema";
            enhanced.suggestion = "Valid types are: 'null', 'boolean', 'object', 'array', 'number', 'integer', 'string'";
            enhanced.example = 'Use "type": "string" instead of "type": "text"';
          }
          break;
          
        case "format":
          if (error.instancePath.endsWith("/format") && error.message.includes("regex")) {
            enhanced.message = "Invalid regular expression pattern";
            enhanced.suggestion = "Ensure the pattern is a valid ECMAScript regular expression";
            enhanced.example = 'Valid: "pattern": "^[a-z]+$", Invalid: "pattern": "^[a-z"';
          }
          break;
          
        case "additionalProperties":
          if (error.instancePath === "") {
            enhanced.message = "Unknown property in schema";
            enhanced.suggestion = "Check for typos in property names or unsupported keywords for this JSON Schema version";
          }
          break;
          
        case "enum":
          if (error.schemaPath.includes("simpleTypes")) {
            enhanced.message = "Invalid type specified";
            enhanced.suggestion = "Use one of the valid JSON Schema types";
            enhanced.example = '"type": "string" or "type": ["string", "null"]';
          }
          break;
      }
      
      return enhanced;
    });
  }
  
  /**
   * Additional semantic validation beyond structural validation
   */
  private validateSemantics(schemaObject: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (typeof schemaObject !== "object" || schemaObject === null) {
      // Boolean schemas are valid, non-objects are handled by structural validation
      return errors;
    }
    
    const schema = schemaObject as Record<string, unknown>;
    
    // Check for conflicting keywords
    if (schema.if && !schema.then && !schema.else) {
      errors.push({
        instancePath: "",
        schemaPath: "#/if",
        keyword: "if",
        message: "Schema has 'if' without 'then' or 'else'",
        suggestion: "Add a 'then' or 'else' clause to make the conditional useful",
        example: '{ "if": {...}, "then": {...}, "else": {...} }',
      });
    }
    
    // Check for deprecated patterns
    if ("definitions" in schema) {
      errors.push({
        instancePath: "/definitions",
        schemaPath: "#/definitions",
        keyword: "definitions",
        message: "Using 'definitions' is deprecated in JSON Schema 2020-12",
        suggestion: "Use '$defs' instead of 'definitions'",
        example: 'Replace "definitions" with "$defs"',
      });
    }
    
    // Check for OpenAPI-specific keywords in pure JSON Schema
    if (!schema.$schema?.toString().includes("openapi") && schema.nullable === true) {
      errors.push({
        instancePath: "/nullable",
        schemaPath: "#/nullable",
        keyword: "nullable",
        message: "'nullable' is an OpenAPI keyword, not valid in standard JSON Schema",
        suggestion: 'Use "type": ["string", "null"] instead of "type": "string", "nullable": true',
      });
    }
    
    // Check for incompatible numeric constraints
    if (
      typeof schema.minimum === "number" &&
      typeof schema.maximum === "number" &&
      schema.minimum > schema.maximum
    ) {
      errors.push({
        instancePath: "",
        schemaPath: "#",
        keyword: "minimum",
        message: "minimum is greater than maximum",
        suggestion: "Ensure minimum <= maximum",
      });
    }
    
    if (
      typeof schema.minLength === "number" &&
      typeof schema.maxLength === "number" &&
      schema.minLength > schema.maxLength
    ) {
      errors.push({
        instancePath: "",
        schemaPath: "#",
        keyword: "minLength",
        message: "minLength is greater than maxLength",
        suggestion: "Ensure minLength <= maxLength",
      });
    }
    
    return errors;
  }
}