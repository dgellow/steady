// Essential OpenAPI 3.0/3.1 types
// Not exhaustive - just what we need for the prototype

export interface OpenAPISpec {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  paths: PathsObject;
  components?: ComponentsObject;
  webhooks?: WebhooksObject; // OpenAPI 3.1
  jsonSchemaDialect?: string; // OpenAPI 3.1
}

export interface InfoObject {
  title: string;
  version: string;
  description?: string;
  summary?: string; // OpenAPI 3.1
  termsOfService?: string;
  contact?: ContactObject;
  license?: LicenseObject;
}

export interface ContactObject {
  name?: string;
  url?: string;
  email?: string;
}

export interface LicenseObject {
  name: string;
  url?: string;
  identifier?: string; // OpenAPI 3.1 - SPDX identifier
}

export interface ServerObject {
  url: string;
  description?: string;
  variables?: { [name: string]: ServerVariableObject };
}

export interface ServerVariableObject {
  enum?: string[];
  default: string;
  description?: string;
}

export interface PathsObject {
  [path: string]: PathItemObject;
}

export interface WebhooksObject {
  [name: string]: PathItemObject;
}

export interface PathItemObject {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
}

export interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: ResponsesObject;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: SchemaObject;
}

export interface RequestBodyObject {
  content: ContentObject;
  required?: boolean;
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject;
}

export interface ResponseObject {
  description?: string;
  content?: ContentObject;
}

export interface ContentObject {
  [mediaType: string]: MediaTypeObject;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: unknown;
  examples?: { [name: string]: ExampleObject };
}

export interface ExampleObject {
  value?: unknown;
  externalValue?: string;
}

export interface ComponentsObject {
  schemas?: { [name: string]: SchemaObject };
  responses?: { [name: string]: ResponseObject };
  parameters?: { [name: string]: ParameterObject };
  examples?: { [name: string]: ExampleObject };
  requestBodies?: { [name: string]: RequestBodyObject };
}

export interface SchemaObject {
  // Reference
  $ref?: string;

  // JSON Schema compatibility (OpenAPI 3.1)
  $schema?: string;
  $id?: string;
  $anchor?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $comment?: string;

  // Basic validation
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null"
    | Array<
      "string" | "number" | "integer" | "boolean" | "array" | "object" | "null"
    >; // OpenAPI 3.1
  format?: string;

  // OpenAPI 3.1 - const and enum
  const?: unknown;
  enum?: unknown[];

  // String validation
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Number validation
  minimum?: number;
  maximum?: number;

  // Array validation
  items?: SchemaObject;
  minItems?: number;
  maxItems?: number;

  // Object validation
  properties?: { [name: string]: SchemaObject };
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  patternProperties?: { [pattern: string]: SchemaObject }; // OpenAPI 3.1
  propertyNames?: SchemaObject; // OpenAPI 3.1
  unevaluatedProperties?: boolean | SchemaObject; // OpenAPI 3.1
  minProperties?: number;
  maxProperties?: number;

  // Composition
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  not?: SchemaObject;

  // Conditional schema (OpenAPI 3.1)
  if?: SchemaObject;
  then?: SchemaObject;
  else?: SchemaObject;
  dependentSchemas?: { [name: string]: SchemaObject };

  // Metadata
  title?: string;
  description?: string;
  default?: unknown;
  example?: unknown; // Deprecated in favor of examples in JSON Schema 2020-12
  examples?: unknown[]; // OpenAPI 3.1 - JSON Schema 2020-12

  // OpenAPI specific
  nullable?: boolean; // Deprecated in OpenAPI 3.1, use type: ["string", "null"] instead
  discriminator?: DiscriminatorObject;
  xml?: XMLObject;
  externalDocs?: ExternalDocsObject;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface DiscriminatorObject {
  propertyName: string;
  mapping?: { [value: string]: string };
}

export interface XMLObject {
  name?: string;
  namespace?: string;
  prefix?: string;
  attribute?: boolean;
  wrapped?: boolean;
}

export interface ExternalDocsObject {
  url: string;
  description?: string;
}
