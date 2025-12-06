// Complete OpenAPI 3.0/3.1 type definitions
// Based on OpenAPI Specification v3.1.0

export interface OpenAPISpec {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  paths: PathsObject;
  components?: ComponentsObject;
  security?: SecurityRequirement[];
  tags?: TagObject[];
  externalDocs?: ExternalDocsObject;
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
  $ref?: string;
  summary?: string;
  description?: string;
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
  trace?: OperationObject;
  servers?: ServerObject[];
  parameters?: (ParameterObject | ReferenceObject)[];
}

export interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: ExternalDocsObject;
  operationId?: string;
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses: ResponsesObject;
  callbacks?: { [callback: string]: CallbackObject | ReferenceObject };
  deprecated?: boolean;
  security?: SecurityRequirement[];
  servers?: ServerObject[];
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  schema?: SchemaObject | ReferenceObject;
  example?: unknown;
  examples?: { [example: string]: ExampleObject | ReferenceObject };
  content?: { [mediaType: string]: MediaTypeObject };
}

export interface RequestBodyObject {
  description?: string;
  content: ContentObject;
  required?: boolean;
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject | ReferenceObject;
}

export interface ResponseObject {
  description: string;
  headers?: { [header: string]: HeaderObject | ReferenceObject };
  content?: ContentObject;
  links?: { [link: string]: LinkObject | ReferenceObject };
}

export interface ContentObject {
  [mediaType: string]: MediaTypeObject;
}

export interface MediaTypeObject {
  schema?: SchemaObject | ReferenceObject;
  example?: unknown;
  examples?: { [name: string]: ExampleObject | ReferenceObject };
  encoding?: { [encoding: string]: EncodingObject };
}

export interface ExampleObject {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
}

export interface ComponentsObject {
  schemas?: { [name: string]: SchemaObject };
  responses?: { [name: string]: ResponseObject | ReferenceObject };
  parameters?: { [name: string]: ParameterObject | ReferenceObject };
  examples?: { [name: string]: ExampleObject | ReferenceObject };
  requestBodies?: { [name: string]: RequestBodyObject | ReferenceObject };
  headers?: { [name: string]: HeaderObject | ReferenceObject };
  securitySchemes?: { [name: string]: SecuritySchemeObject | ReferenceObject };
  links?: { [name: string]: LinkObject | ReferenceObject };
  callbacks?: { [name: string]: CallbackObject | ReferenceObject };
  pathItems?: { [name: string]: PathItemObject | ReferenceObject }; // OpenAPI 3.1
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

// Reference Object
export interface ReferenceObject {
  $ref: string;
  summary?: string; // OpenAPI 3.1
  description?: string; // OpenAPI 3.1
}

// Tag Object
export interface TagObject {
  name: string;
  description?: string;
  externalDocs?: ExternalDocsObject;
}

// Header Object
export interface HeaderObject {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  schema?: SchemaObject | ReferenceObject;
  example?: unknown;
  examples?: { [example: string]: ExampleObject | ReferenceObject };
  content?: { [mediaType: string]: MediaTypeObject };
}

// Encoding Object
export interface EncodingObject {
  contentType?: string;
  headers?: { [header: string]: HeaderObject | ReferenceObject };
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}

// Link Object
export interface LinkObject {
  operationRef?: string;
  operationId?: string;
  parameters?: { [parameter: string]: unknown };
  requestBody?: unknown;
  description?: string;
  server?: ServerObject;
}

// Callback Object
export interface CallbackObject {
  [expression: string]: PathItemObject | ReferenceObject;
}

// Security Requirement Object
export interface SecurityRequirement {
  [name: string]: string[];
}

// Security Scheme Object
export interface SecuritySchemeObject {
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string; // For apiKey
  in?: "query" | "header" | "cookie"; // For apiKey
  scheme?: string; // For http
  bearerFormat?: string; // For http bearer
  flows?: OAuthFlowsObject; // For oauth2
  openIdConnectUrl?: string; // For openIdConnect
}

// OAuth Flows Object
export interface OAuthFlowsObject {
  implicit?: OAuthFlowObject;
  password?: OAuthFlowObject;
  clientCredentials?: OAuthFlowObject;
  authorizationCode?: OAuthFlowObject;
}

// OAuth Flow Object
export interface OAuthFlowObject {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: { [scope: string]: string };
}
