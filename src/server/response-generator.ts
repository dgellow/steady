import type { ResponseObject } from "../types.ts";
import { HEADERS } from "../types.ts";
import type { ReferenceObject } from "@steady/openapi";
import { isReference, OpenAPISpec } from "@steady/openapi";
import { RegistryResponseGenerator } from "@steady/json-schema";
import type {
  GenerateOptions,
  Schema,
  SchemaRegistry,
} from "@steady/json-schema";
import {
  formatFragmentPointer,
  isFragmentPointer,
  isPlainObject,
} from "@steady/json-pointer";
import type { Logger } from "../logging/logger.ts";
import type { Diagnostic } from "../diagnostic.ts";
import type { DiagnosticCollector } from "../diagnostics/collector.ts";
import { isMinimalResponse } from "../diagnostics/response-check.ts";
import {
  createStreamingResponse,
  getStreamFormat,
  isStreamingContentType,
  type StreamingOptions,
} from "../streaming.ts";
import {
  APPLICATION_JSON,
  getMediaType,
  isJsonMediaType,
  isMediaRange,
  negotiateMediaType,
  parseAccept,
} from "../media-type.ts";
import type { AcceptEntry, MediaTypeEssence } from "../media-type.ts";
import { encodeHeaderText, encodeUriReference } from "../http-header.ts";

/** Status codes that MUST NOT have a response body (101, 204, 205, 304). */
const NULL_BODY_STATUS_STRINGS = new Set(["101", "204", "205", "304"]);

/**
 * Whether the client accepts a JSON body: application/json is acceptable
 * under the Accept header, or the header names another JSON type with a
 * non-zero weight (e.g. application/vnd.api+json).
 */
function acceptsJson(accept: readonly AcceptEntry[]): boolean {
  if (negotiateMediaType(accept, [APPLICATION_JSON]) !== null) return true;
  return accept.some((entry) => entry.q > 0 && isJsonMediaType(entry.range));
}

/**
 * Generate response from a resolved ResponseObject
 */
export function generateResponseFromObject(
  specDoc: OpenAPISpec,
  logger: Logger,
  collector: DiagnosticCollector,
  requestAcceptHeader: string | null,
  responseObj: ResponseObject,
  statusCode: string,
  path: string,
  method: string,
  pathPattern: string,
  generatorOptions: GenerateOptions,
  streamingOptions: StreamingOptions,
): {
  response: Response;
  body?: unknown;
  minimal?: boolean;
  nullBodyStripped?: boolean;
} {
  const registry = specDoc.registry;
  let body: unknown = null;
  let contentType: string | null = null;
  let minimal = false;
  let nullBodyStripped = false;

  const accept = requestAcceptHeader ? parseAccept(requestAcceptHeader) : [];

  if (responseObj.content) {
    // Build parallel arrays of raw keys and parsed essences, skipping
    // entries where the content type key is unparseable.
    const contentKeys: string[] = [];
    const contentEssences: MediaTypeEssence[] = [];
    for (const k of Object.keys(responseObj.content)) {
      const e = getMediaType(k);
      if (e) {
        contentKeys.push(k);
        contentEssences.push(e);
      }
    }

    if (contentKeys.length === 0) {
      logger.warning(
        `Response for ${method.toUpperCase()} ${path} has no parseable content types.`,
      );
    }

    // Select content type by negotiating the Accept header against the
    // spec's content keys (RFC 9110 section 12.5.1). When nothing is
    // acceptable the first content type in the spec is used: a mock server
    // must always return something. When no parseable keys exist,
    // selectedContentType stays undefined and we default to application/json
    // below.
    let selectedContentType: string | undefined = contentKeys[0];
    let responseContentType: string | undefined;
    const negotiated = negotiateMediaType(accept, contentEssences);
    if (negotiated) {
      selectedContentType = contentKeys[negotiated.index];
      const selectedEssence = contentEssences[negotiated.index];
      // When the spec key is a range (e.g. */*) but the client asked for a
      // specific type, respond with the client's type, not the range.
      if (
        selectedEssence !== undefined && isMediaRange(selectedEssence) &&
        !isMediaRange(negotiated.range)
      ) {
        responseContentType = negotiated.range;
      }
    }

    // Check if selected content type is streaming
    if (selectedContentType && isStreamingContentType(selectedContentType)) {
      const mediaType = responseObj.content[selectedContentType];
      if (mediaType?.schema || mediaType?.example) {
        // Pass example to streaming options for SSE event sequences
        if (mediaType.example !== undefined) {
          streamingOptions.example = mediaType.example;
        }
        // Streaming responses need a schema to generate from
        if (mediaType.schema) {
          return {
            response: generateStreamingResponse(
              registry,
              logger,
              mediaType.schema,
              pathPattern,
              method,
              statusCode,
              selectedContentType,
              streamingOptions,
            ),
            body: "[streaming]",
          };
        }
      }
    }

    const mediaType = selectedContentType
      ? responseObj.content[selectedContentType]
      : Object.values(responseObj.content)[0];

    if (mediaType) {
      contentType = responseContentType ?? selectedContentType ??
        "application/json";

      // Priority 1: Explicit example
      if (mediaType.example !== undefined) {
        body = mediaType.example;
      } // Priority 2: First example from examples map
      else if (
        mediaType.examples && Object.keys(mediaType.examples).length > 0
      ) {
        const firstExampleOrRef = Object.values(mediaType.examples)[0];
        if (firstExampleOrRef) {
          if (isReference(firstExampleOrRef)) {
            // Resolve $ref to ExampleObject and extract .value
            const resolved = specDoc.resolveRef(firstExampleOrRef.$ref);
            if (isPlainObject(resolved) && "value" in resolved) {
              body = resolved.value;
            }
          } else if (firstExampleOrRef.value !== undefined) {
            body = firstExampleOrRef.value;
          }
        }
      }

      // Priority 3: Generate from schema (also serves as fallback when
      // examples were all unresolvable $refs)
      if (body === null && mediaType.schema) {
        body = generateFromSchemaObject(
          registry,
          mediaType.schema,
          pathPattern,
          method,
          statusCode,
          generatorOptions,
        );

        if (isMinimalResponse(body, mediaType.schema)) {
          collector.trackGenerationWarning(method, pathPattern);
          minimal = true;
        }
      }

      // Generator returns null when the schema gives it no shape to
      // infer (e.g. `schema: {}` or `true`, which per JSON Schema
      // accept any instance). An empty body is not valid JSON for
      // the client, so at the HTTP boundary fall back to {}. Mirrors
      // the "no content object" branch below.
      if (
        body === null &&
        contentType &&
        !NULL_BODY_STATUS_STRINGS.has(statusCode)
      ) {
        const essence = getMediaType(contentType);
        if (essence && isJsonMediaType(essence)) {
          body = {};
        }
      }
    }
  } else if (
    acceptsJson(accept) && !NULL_BODY_STATUS_STRINGS.has(statusCode)
  ) {
    // No content defined in spec, but client accepts JSON - return empty object
    // (except for null-body statuses which must not have a body)
    contentType = "application/json";
    body = {};
  }

  const headers = new Headers({
    [HEADERS.MATCHED_PATH]: encodeHeaderText(pathPattern),
    [HEADERS.EXAMPLE_SOURCE]: body !== null ? "generated" : "none",
  });
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  // 3xx redirects require a Location header per RFC 9110.
  // Priority: 1) header example, 2) schema default, 3) synthetic fallback.
  const numericStatus = parseInt(statusCode, 10);
  if (numericStatus >= 300 && numericStatus < 400) {
    const location = resolveLocationHeader(specDoc, responseObj);
    headers.set("Location", encodeUriReference(location));
  }

  // Null-body status codes must not have a body per HTTP semantics.
  // Some specs incorrectly define content for these. Strip it to avoid crashes.
  const isNullBodyStatus = NULL_BODY_STATUS_STRINGS.has(statusCode);
  if (isNullBodyStatus && body !== null) {
    body = null;
    contentType = null;
    headers.delete("Content-Type");
    nullBodyStripped = true;
  }

  // Serialize body according to content type.
  // JSON content types get JSON.stringify; everything else (octet-stream,
  // text/plain, etc.) gets the raw value as a string.
  let bodyString: string | null = null;
  if (body !== null) {
    const essence = contentType ? getMediaType(contentType) : null;

    if (essence && isJsonMediaType(essence)) {
      try {
        bodyString = JSON.stringify(body, null, 2);
      } catch (error) {
        // Handle non-serializable values (circular refs, BigInt, etc.)
        const errorMessage = error instanceof Error
          ? error.message
          : "Unknown serialization error";
        logger.warning(
          `Failed to serialize response body: ${errorMessage}`,
          {
            hint:
              "Response contains non-serializable values (circular references, BigInt, etc.)",
          },
        );
        bodyString = JSON.stringify(
          {
            error: "Response serialization failed",
            reason: errorMessage,
            hint:
              "The generated response contains non-serializable values (circular references, BigInt, etc.)",
          },
          null,
          2,
        );
        headers.set(HEADERS.SERIALIZATION_ERROR, "true");
      }
    } else {
      bodyString = String(body);
    }
  }

  return {
    response: new Response(
      bodyString,
      {
        status: parseInt(statusCode, 10),
        headers,
      },
    ),
    body,
    minimal,
    nullBodyStripped,
  };
}

/**
 * Generate a streaming response (NDJSON or SSE)
 */
function generateStreamingResponse(
  registry: SchemaRegistry,
  logger: Logger,
  schema: Schema | ReferenceObject,
  pathPattern: string,
  method: string,
  statusCode: string,
  contentType: string,
  streamingOptions: StreamingOptions,
): Response {
  const format = getStreamFormat(contentType);
  if (!format) {
    // Fallback to JSON if format detection fails
    throw new Error(`Unknown streaming format: ${contentType}`);
  }

  const schemaPointer = formatFragmentPointer([
    "paths",
    pathPattern,
    method,
    "responses",
    statusCode,
    "content",
    contentType,
    "schema",
  ]);

  const { stream, warnings } = createStreamingResponse(
    registry,
    schema,
    schemaPointer,
    format,
    streamingOptions,
  );
  for (const w of warnings) {
    logger.warning(w);
  }

  const headers = new Headers({
    "Content-Type": contentType,
    [HEADERS.MATCHED_PATH]: encodeHeaderText(pathPattern),
    [HEADERS.EXAMPLE_SOURCE]: "generated",
    [HEADERS.STREAMING]: "true",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // For SSE, add specific headers
  if (format === "sse") {
    headers.set("X-Accel-Buffering", "no"); // Disable nginx buffering
  }

  return new Response(stream, {
    status: parseInt(statusCode, 10),
    headers,
  });
}

/**
 * Generate data from a schema object using the registry
 */
function generateFromSchemaObject(
  registry: SchemaRegistry,
  schema: Schema | ReferenceObject,
  pathPattern: string,
  method: string,
  statusCode: string,
  generatorOptions: GenerateOptions,
): unknown {
  const generator = new RegistryResponseGenerator(registry, generatorOptions);

  // If schema is a $ref, resolve and generate via the registry
  if (
    "$ref" in schema && typeof schema.$ref === "string" &&
    isFragmentPointer(schema.$ref)
  ) {
    return generator.generate(schema.$ref);
  }

  // Inline schema: generate directly
  return generator.generateFromSchema(
    schema,
    formatFragmentPointer([
      "paths",
      pathPattern,
      method,
      "responses",
      statusCode,
      "content",
      "application/json",
      "schema",
    ]),
  );
}

/**
 * Resolve a Location header value for 3xx responses.
 * Priority: 1) header example, 2) schema default, 3) /_x-steady/redirected.
 */
function resolveLocationHeader(
  specDoc: OpenAPISpec,
  responseObj: ResponseObject,
): string {
  if (responseObj.headers) {
    // Find Location header (case-insensitive)
    const locationKey = Object.keys(responseObj.headers).find(
      (h) => h.toLowerCase() === "location",
    );
    if (locationKey) {
      let headerDef = responseObj.headers[locationKey];

      // Resolve header-level $ref
      if (headerDef && isReference(headerDef)) {
        const resolved = specDoc.resolveRef(headerDef.$ref);
        if (isPlainObject(resolved)) {
          headerDef = resolved;
        }
      }

      if (headerDef && !isReference(headerDef)) {
        // 1) Explicit example on the header
        if (headerDef.example !== undefined) {
          return String(headerDef.example);
        }
        // 2) Default from the schema
        if (headerDef.schema) {
          let schemaDef = headerDef.schema;

          // Resolve schema-level $ref
          if (isReference(schemaDef)) {
            const resolved = specDoc.resolveRef(schemaDef.$ref);
            if (isPlainObject(resolved)) {
              schemaDef = resolved;
            }
          }

          if (!isReference(schemaDef) && schemaDef.default !== undefined) {
            return String(schemaDef.default);
          }
        }
      }
    }
  }
  // 3) Synthetic fallback
  return "/_x-steady/redirected";
}

/**
 * Add X-Steady-* diagnostic headers to a response.
 * X-Steady-Request-Valid is false when any sdk-issue diagnostic is present.
 *
 * Path and message can quote the request, so they go through
 * encodeHeaderText. Clients read them back with a percent-decoder.
 */
export function addDiagnosticHeaders(
  response: Response,
  diagnostics: Diagnostic[],
): Response {
  const newHeaders = new Headers(response.headers);
  const hasSdkIssues = diagnostics.some((d) => d.category === "sdk-issue");

  newHeaders.set("X-Steady-Request-Valid", hasSdkIssues ? "false" : "true");
  newHeaders.set("X-Steady-Error-Count", String(diagnostics.length));

  diagnostics.forEach((d, i) => {
    const n = i + 1;
    newHeaders.set(`X-Steady-Error-${n}-Code`, d.code);
    newHeaders.set(
      `X-Steady-Error-${n}-Path`,
      encodeHeaderText(d.requestPath),
    );
    newHeaders.set(
      `X-Steady-Error-${n}-Message`,
      encodeHeaderText(d.message),
    );
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
