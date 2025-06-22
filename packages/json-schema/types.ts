/**
 * JSON Schema type definitions
 * Based on JSON Schema 2020-12 specification
 */

export interface JsonSchemaDialects {
  "http://json-schema.org/draft-04/schema#": "draft-04";
  "http://json-schema.org/draft-06/schema#": "draft-06";
  "http://json-schema.org/draft-07/schema#": "draft-07";
  "https://json-schema.org/draft/2019-09/schema": "draft-2019-09";
  "https://json-schema.org/draft/2020-12/schema": "draft-2020-12";
  "https://spec.openapis.org/oas/3.1/dialect/base": "openapi-3.1";
}

export type JsonSchemaDialect = keyof JsonSchemaDialects;

export interface BaseSchema {
  // Core keywords
  $schema?: string;
  $id?: string;
  $ref?: string;
  $anchor?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $vocabulary?: Record<string, boolean>;
  $comment?: string;
  $defs?: Record<string, Schema>;

  // Metadata
  title?: string;
  description?: string;
  default?: unknown;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  examples?: unknown[];
}

export interface TypeSchema extends BaseSchema {
  // Type validation
  type?: SchemaType | SchemaType[];
  enum?: unknown[];
  const?: unknown;

  // Numeric validation
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;

  // String validation
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;

  // Array validation
  items?: Schema | Schema[];
  prefixItems?: Schema[];
  unevaluatedItems?: boolean | Schema;
  contains?: Schema;
  minContains?: number;
  maxContains?: number;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;

  // Object validation
  properties?: Record<string, Schema>;
  patternProperties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  unevaluatedProperties?: boolean | Schema;
  propertyNames?: Schema;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, Schema>;

  // Composition
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  not?: Schema;

  // Conditional
  if?: Schema;
  then?: Schema;
  else?: Schema;
}

export interface OpenApiExtensions {
  // OpenAPI specific extensions
  nullable?: boolean; // Deprecated in OpenAPI 3.1
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
  xml?: {
    name?: string;
    namespace?: string;
    prefix?: string;
    attribute?: boolean;
    wrapped?: boolean;
  };
  externalDocs?: {
    url: string;
    description?: string;
  };
  example?: unknown; // Deprecated in favor of examples
}

export type Schema = TypeSchema & OpenApiExtensions;

export type SchemaType =
  | "null"
  | "boolean"
  | "object"
  | "array"
  | "number"
  | "integer"
  | "string";

export interface ValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
  schema?: unknown;
  data?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidatorOptions {
  dialect?: JsonSchemaDialect;
  strict?: boolean;
  validateFormats?: boolean;
  allowUnknownFormats?: boolean;
  removeAdditional?: boolean | "all" | "failing";
}
