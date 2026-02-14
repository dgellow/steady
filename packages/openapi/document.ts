/**
 * SpecDocument implementation. Structured access to an OpenAPI spec.
 *
 * Wraps a parsed OpenAPISpec and provides the interface the diagnostics
 * engine needs: parameters, body schemas, response checking, and schema
 * resolution. Handles $ref resolution and parameter merging.
 *
 * This module bridges packages/openapi/ and src/engine/. The engine
 * works against the SpecDocument interface, not raw OpenAPI types.
 */

import type { Schema } from "@steady/json-schema";
import { resolve as resolvePointer } from "@steady/json-pointer";
import type {
  OpenAPISpec,
  OperationObject,
  ParameterObject,
  PathItemObject,
  PathsObject,
  ReferenceObject,
  RequestBodyObject,
} from "./openapi.ts";

// ── Local types ────────────────────────────────────────────────────
// These describe the shape of this module's output. The canonical
// contract types (SpecDocument, ResolvedParameter, BodySchemaInfo)
// live in src/engine/diagnostic-engine.ts. A compile-time test
// verifies that OpenAPISpecDocument satisfies SpecDocument.

interface ResolvedParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: Schema | null;
  schemaPath: string | null;
  style?: string;
  explode?: boolean;
}

interface BodySchemaInfo {
  schema: Schema;
  schemaPath: string;
  required: boolean;
}

// ── Type guards ────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard for ParameterObject resolved from a $ref.
 * Checks the essential discriminating properties (name, in).
 */
function isParameterLike(value: unknown): value is ParameterObject {
  if (!isPlainObject(value)) return false;
  return typeof value["name"] === "string" && typeof value["in"] === "string";
}

/**
 * Type guard for RequestBodyObject resolved from a $ref.
 * Checks for the essential `content` property.
 */
function isRequestBodyLike(value: unknown): value is RequestBodyObject {
  if (!isPlainObject(value)) return false;
  return "content" in value && isPlainObject(value["content"]);
}

/**
 * Type guard for Schema. Since all Schema fields are optional,
 * any plain object satisfies the structural contract.
 */
function isSchemaLike(value: unknown): value is Schema {
  return isPlainObject(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// ── Implementation ─────────────────────────────────────────────────

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export class OpenAPISpecDocument {
  private readonly spec: OpenAPISpec;

  constructor(spec: OpenAPISpec) {
    this.spec = spec;
  }

  get paths(): PathsObject {
    return this.spec.paths;
  }

  /**
   * Resolved parameters for an operation.
   *
   * Merges path-level and operation-level parameters. Operation-level
   * overrides path-level when name+in match. Resolves $refs.
   * Path parameters have required=true (implicit per OpenAPI spec).
   */
  getParameters(pathPattern: string, method: string): ResolvedParameter[] {
    const pathItem = this.spec.paths[pathPattern];
    if (!pathItem) return [];

    const operation = this.getOperation(pathItem, method);
    if (!operation) return [];

    // Collect raw params: path-level first, then operation-level
    const pathLevelParams = pathItem.parameters ?? [];
    const operationParams = operation.parameters ?? [];

    // Resolve all $refs
    const resolvedPathLevel = pathLevelParams.map((p, i) =>
      this.resolveParamRef(p, pathPattern, "pathItem", undefined, i)
    ).filter(isDefined);

    const resolvedOpLevel = operationParams.map((p, i) =>
      this.resolveParamRef(p, pathPattern, "operation", method, i)
    ).filter(isDefined);

    // Merge: operation overrides path-level (by name + in)
    const merged = new Map<
      string,
      { param: ParameterObject; pointer: string }
    >();

    for (const entry of resolvedPathLevel) {
      const key = `${entry.param.in}:${entry.param.name}`;
      merged.set(key, entry);
    }
    for (const entry of resolvedOpLevel) {
      const key = `${entry.param.in}:${entry.param.name}`;
      merged.set(key, entry);
    }

    // Map to ResolvedParameter
    return Array.from(merged.values()).map(({ param, pointer }) => {
      const rawSchema = param.schema;
      const hasSchema = rawSchema !== undefined && isSchemaLike(rawSchema);

      return {
        name: param.name,
        in: param.in,
        // Path parameters are implicitly required per OpenAPI spec
        required: param.in === "path" ? true : param.required === true,
        schema: hasSchema ? rawSchema : null,
        schemaPath: hasSchema ? `${pointer}/schema` : null,
        style: param.style,
        explode: param.explode,
      };
    });
  }

  /**
   * Body schema for an operation. null if no requestBody defined.
   * Currently supports application/json content type.
   */
  getBodySchema(pathPattern: string, method: string): BodySchemaInfo | null {
    const pathItem = this.spec.paths[pathPattern];
    if (!pathItem) return null;

    const operation = this.getOperation(pathItem, method);
    if (!operation) return null;

    if (!operation.requestBody) return null;

    // Resolve $ref if needed
    let requestBody: RequestBodyObject;
    if ("$ref" in operation.requestBody) {
      const resolved = this.resolveRef(operation.requestBody.$ref);
      if (!isRequestBodyLike(resolved)) return null;
      requestBody = resolved;
    } else {
      requestBody = operation.requestBody;
    }

    // Find application/json content
    const jsonContent = requestBody.content["application/json"];
    if (!jsonContent?.schema) return null;

    // Ensure schema is a plain object (not a $ref, those should be resolved upstream)
    if (!isSchemaLike(jsonContent.schema)) return null;

    // Build the schema path
    const escapedPath = escapeJsonPointer(pathPattern);
    const schemaPath =
      `#/paths/${escapedPath}/${method}/requestBody/content/application~1json/schema`;

    return {
      schema: jsonContent.schema,
      schemaPath,
      required: requestBody.required === true,
    };
  }

  /**
   * Whether an operation has at least one response defined.
   */
  hasResponses(pathPattern: string, method: string): boolean {
    const pathItem = this.spec.paths[pathPattern];
    if (!pathItem) return false;

    const operation = this.getOperation(pathItem, method);
    if (!operation) return false;

    return Object.keys(operation.responses).length > 0;
  }

  /**
   * Accepted content types for a request body.
   * Returns the keys of requestBody.content, or null if no requestBody.
   */
  getAcceptedContentTypes(
    pathPattern: string,
    method: string,
  ): string[] | null {
    const pathItem = this.spec.paths[pathPattern];
    if (!pathItem) return null;

    const operation = this.getOperation(pathItem, method);
    if (!operation) return null;

    if (!operation.requestBody) return null;

    // Resolve $ref if needed
    let requestBody: RequestBodyObject;
    if ("$ref" in operation.requestBody) {
      const resolved = this.resolveRef(operation.requestBody.$ref);
      if (!isRequestBodyLike(resolved)) return null;
      requestBody = resolved;
    } else {
      requestBody = operation.requestBody;
    }

    const keys = Object.keys(requestBody.content);
    return keys.length > 0 ? keys : null;
  }

  /**
   * Resolve a schema by its JSON pointer in the spec.
   * Returns empty schema {} if the pointer can't be resolved.
   */
  resolveSchema(schemaPath: string): Schema {
    const pointer = stripFragment(schemaPath);
    try {
      const resolved = resolvePointer(this.spec, pointer);
      if (isSchemaLike(resolved)) {
        return resolved;
      }
      return {};
    } catch {
      return {};
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getOperation(
    pathItem: PathItemObject,
    method: string,
  ): OperationObject | undefined {
    const lower = method.toLowerCase();
    if (!isHttpMethod(lower)) return undefined;
    const ops: Pick<PathItemObject, HttpMethod> = pathItem;
    return ops[lower];
  }

  /**
   * Resolve a parameter that may be a $ref.
   * Returns the resolved ParameterObject and its JSON pointer in the spec.
   */
  private resolveParamRef(
    paramOrRef: ParameterObject | ReferenceObject,
    pathPattern: string,
    level: "pathItem" | "operation",
    method: string | undefined,
    index: number,
  ): { param: ParameterObject; pointer: string } | undefined {
    if ("$ref" in paramOrRef) {
      const resolved = this.resolveRef(paramOrRef.$ref);
      if (!isParameterLike(resolved)) return undefined;
      // Pointer for the $ref target
      const pointer = paramOrRef.$ref.replace(/^#/, "");
      return { param: resolved, pointer: `#${pointer}` };
    }

    // Inline parameter. Compute its pointer
    const escapedPath = escapeJsonPointer(pathPattern);
    let pointer: string;
    if (level === "pathItem") {
      pointer = `#/paths/${escapedPath}/parameters/${index}`;
    } else {
      pointer = `#/paths/${escapedPath}/${method}/parameters/${index}`;
    }

    return { param: paramOrRef, pointer };
  }

  /**
   * Resolve a $ref string against the spec document.
   */
  private resolveRef(ref: string): unknown {
    const pointer = stripFragment(ref);
    try {
      return resolvePointer(this.spec, pointer);
    } catch {
      return undefined;
    }
  }
}

// ── Utility functions ──────────────────────────────────────────────

function stripFragment(ref: string): string {
  if (ref.startsWith("#")) {
    return ref.slice(1);
  }
  return ref;
}

function escapeJsonPointer(path: string): string {
  return path.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isHttpMethod(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}
