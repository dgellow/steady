/**
 * Metaschema Validator - Validates JSON Schemas against the JSON Schema metaschema
 * 
 * This ensures that schemas themselves are valid before we use them to validate data.
 * Critical for providing clear error messages when schemas are malformed.
 */

import type { ValidationResult, ValidationError } from "./types.ts";
import { JsonSchemaValidator } from "./validator_legacy.ts";

// JSON Schema 2020-12 metaschema (simplified for initial implementation)
// In production, we'd load the full metaschema from the spec
const METASCHEMA_2020_12 = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://json-schema.org/draft/2020-12/schema",
  "$vocabulary": {
    "https://json-schema.org/draft/2020-12/vocab/core": true,
    "https://json-schema.org/draft/2020-12/vocab/applicator": true,
    "https://json-schema.org/draft/2020-12/vocab/validation": true,
    "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
    "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
    "https://json-schema.org/draft/2020-12/vocab/content": true,
    "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
  },
  "type": ["object", "boolean"],
  "properties": {
    // Core vocabulary
    "$id": { "type": "string", "format": "uri-reference" },
    "$schema": { "type": "string", "format": "uri" },
    "$ref": { "type": "string", "format": "uri-reference" },
    "$anchor": { "type": "string", "pattern": "^[A-Za-z_][-A-Za-z0-9._]*$" },
    "$dynamicRef": { "type": "string", "format": "uri-reference" },
    "$dynamicAnchor": { "type": "string", "pattern": "^[A-Za-z_][-A-Za-z0-9._]*$" },
    "$vocabulary": { "type": "object", "additionalProperties": { "type": "boolean" } },
    "$comment": { "type": "string" },
    "$defs": { "type": "object", "additionalProperties": { "$ref": "#" } },
    
    // Metadata
    "title": { "type": "string" },
    "description": { "type": "string" },
    "default": {},
    "deprecated": { "type": "boolean" },
    "readOnly": { "type": "boolean" },
    "writeOnly": { "type": "boolean" },
    "examples": { "type": "array" },
    
    // Type validation
    "type": {
      "anyOf": [
        { "$ref": "#/$defs/simpleTypes" },
        {
          "type": "array",
          "items": { "$ref": "#/$defs/simpleTypes" },
          "minItems": 1,
          "uniqueItems": true,
        },
      ],
    },
    "enum": { "type": "array", "minItems": 1 },
    "const": {},
    
    // Numeric validation
    "multipleOf": { "type": "number", "exclusiveMinimum": 0 },
    "maximum": { "type": "number" },
    "exclusiveMaximum": { "type": "number" },
    "minimum": { "type": "number" },
    "exclusiveMinimum": { "type": "number" },
    
    // String validation
    "maxLength": { "$ref": "#/$defs/nonNegativeInteger" },
    "minLength": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
    "pattern": { "type": "string", "format": "regex" },
    "format": { "type": "string" },
    
    // Array validation
    "items": { "$ref": "#" },
    "prefixItems": { "$ref": "#/$defs/schemaArray" },
    "unevaluatedItems": { "$ref": "#" },
    "contains": { "$ref": "#" },
    "minContains": { "$ref": "#/$defs/nonNegativeInteger" },
    "maxContains": { "$ref": "#/$defs/nonNegativeInteger" },
    "maxItems": { "$ref": "#/$defs/nonNegativeInteger" },
    "minItems": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
    "uniqueItems": { "type": "boolean", "default": false },
    
    // Object validation
    "properties": { "type": "object", "additionalProperties": { "$ref": "#" } },
    "patternProperties": {
      "type": "object",
      "additionalProperties": { "$ref": "#" },
      "propertyNames": { "format": "regex" },
    },
    "additionalProperties": { "$ref": "#" },
    "unevaluatedProperties": { "$ref": "#" },
    "propertyNames": { "$ref": "#" },
    "maxProperties": { "$ref": "#/$defs/nonNegativeInteger" },
    "minProperties": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
    "required": { "$ref": "#/$defs/stringArray" },
    "dependentRequired": {
      "type": "object",
      "additionalProperties": { "$ref": "#/$defs/stringArray" },
    },
    "dependentSchemas": {
      "type": "object",
      "additionalProperties": { "$ref": "#" },
    },
    
    // Composition
    "allOf": { "$ref": "#/$defs/schemaArray" },
    "anyOf": { "$ref": "#/$defs/schemaArray" },
    "oneOf": { "$ref": "#/$defs/schemaArray" },
    "not": { "$ref": "#" },
    
    // Conditional
    "if": { "$ref": "#" },
    "then": { "$ref": "#" },
    "else": { "$ref": "#" },
  },
  "$defs": {
    "simpleTypes": {
      "enum": ["array", "boolean", "integer", "null", "number", "object", "string"],
    },
    "nonNegativeInteger": {
      "type": "integer",
      "minimum": 0,
    },
    "nonNegativeIntegerDefault0": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
    },
    "stringArray": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true,
      "default": [],
    },
    "schemaArray": {
      "type": "array",
      "items": { "$ref": "#" },
    },
  },
};

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
  async validate(schemaObject: unknown): Promise<ValidationResult> {
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
    const result = this.validator.validate(METASCHEMA_2020_12, schemaObject);
    
    // Enhance errors with better messages for common issues
    if (!result.valid) {
      result.errors = this.enhanceErrors(result.errors, schemaObject);
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
  private enhanceErrors(errors: ValidationError[], schema: unknown): ValidationError[] {
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