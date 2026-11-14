// Complete OpenAPI 3.0/3.1 type definitions
// Based on OpenAPI Specification v3.1.0

import { isPlainObject } from "@steady/json-pointer";
import type { Schema } from "@steady/json-schema";

/**
 * Type guard that narrows `unknown` to `ReferenceObject`.
 *
 * An OpenAPI Reference Object is any plain object with a `$ref: string`
 * field. Per OpenAPI 3.1, references are structurally identified by the
 * presence of this field, not by a discriminator keyword.
 */
export function isReference(value: unknown): value is ReferenceObject {
  return isPlainObject(value) && typeof value["$ref"] === "string";
}

export interface OpenAPIRaw {
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
  query?: OperationObject;
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
  /**
   * Optional: OpenAPI 3.1 does not require it, and 3.0 specs omit it too.
   * The analyzer reports an operation without responses (E1010).
   */
  responses?: ResponsesObject;
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

/**
 * Schema type for OpenAPI specifications.
 * This is the canonical JSON Schema type from @steady/json-schema, which
 * includes all JSON Schema 2020-12 keywords plus OpenAPI extensions
 * (nullable, discriminator, xml, externalDocs).
 */
export type SchemaObject = Schema;

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
