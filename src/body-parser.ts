/**
 * Body Parser - Extract and parse HTTP request bodies.
 *
 * Handles HTTP-level concerns that happen before schema validation:
 * - Content-Length validation
 * - JSON parsing
 * - Form data parsing (multipart, URL-encoded)
 *
 * Returns either a parsed body or Diagnostic[] on failure.
 */

import type { Diagnostic } from "./diagnostic.ts";
import { getCode } from "./codes/registry.ts";
import {
  type FormParserOptions,
  parseFormData,
  parseUrlEncoded,
} from "./form-parser.ts";
import {
  getMediaType,
  isFormMediaType,
  isJsonMediaType,
  isMultipartFormData,
} from "./media-type.ts";
import type {
  MediaTypeEssence,
  MultipartFormData,
  UrlEncoded,
} from "./media-type.ts";

/**
 * What a request carried as its body. Each state is distinct for the
 * diagnostic engine: an absent body may violate `requestBody.required`, an
 * unlabelled one is missing its Content-Type, a parsed one is validated.
 */
export type RequestBody =
  /** Zero bytes. */
  | { kind: "absent" }
  /** Bytes were sent without a Content-Type, so they cannot be interpreted. */
  | { kind: "unlabelled"; byteLength: number }
  | {
    kind: "parsed";
    value: unknown;
    /** Essence of the Content-Type header, or null when it does not parse. */
    mediaType: MediaTypeEssence | null;
    /** Raw form entry key names (with duplicates) for format mismatch detection. */
    rawFormKeys?: string[];
  }
  /** The body or its framing is malformed at the HTTP level. */
  | { kind: "invalid"; diagnostics: Diagnostic[] };

/**
 * Read and parse the request body.
 *
 * The bytes are read once, here. Deno's HTTP server gives every request a
 * body stream, also bodyless ones, so the only reliable sign of a body is
 * that it has bytes.
 *
 * @param req - The incoming Request
 * @param formOptions - Options for form data parsing (format, schema for coercion)
 */
export async function parseRequestBody(
  req: Request,
  formOptions?: FormParserOptions,
): Promise<RequestBody> {
  // Check Content-Length header validity
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size) || size < 0) {
      const def = getCode("E3019");
      return {
        kind: "invalid",
        diagnostics: [{
          code: "E3019",
          severity: def.severity,
          category: def.category,
          requestPath: "body",
          specPointer: "",
          message:
            `Invalid Content-Length header: "${contentLength}" is not a valid non-negative integer`,
          expected: "valid non-negative integer",
          actual: contentLength,
          attribution: {
            confidence: 0.95,
            reasoning: [
              "Content-Length must be a non-negative integer per HTTP/1.1 (RFC 9110)",
            ],
          },
          suggestion:
            "Ensure the HTTP client sets a valid Content-Length header",
        }],
      };
    }
  }

  const contentTypeHeader = req.headers.get("content-type");
  const maybeMediaType = contentTypeHeader
    ? getMediaType(contentTypeHeader)
    : null;

  try {
    const bytes = new Uint8Array(await req.arrayBuffer());

    // Zero bytes is "no body", whatever the headers say. SDKs commonly set
    // Content-Type: application/json on all requests, including DELETE and
    // cancel endpoints that have no body. The diagnostic engine emits E3005
    // if the spec requires a body.
    if (bytes.length === 0) {
      return { kind: "absent" };
    }

    if (!contentTypeHeader) {
      return { kind: "unlabelled", byteLength: bytes.length };
    }

    if (maybeMediaType && isFormMediaType(maybeMediaType)) {
      const formResult = await parseFormBody(
        bytes,
        contentTypeHeader,
        maybeMediaType,
        formOptions,
      );
      return {
        kind: "parsed",
        value: formResult.body,
        mediaType: maybeMediaType,
        rawFormKeys: formResult.rawFormKeys,
      };
    }

    const text = new TextDecoder().decode(bytes);
    if (maybeMediaType && isJsonMediaType(maybeMediaType)) {
      return {
        kind: "parsed",
        value: JSON.parse(text),
        mediaType: maybeMediaType,
      };
    }

    // Any other media type, or one that does not parse: keep the text.
    return { kind: "parsed", value: text, mediaType: maybeMediaType };
  } catch (error) {
    if (error instanceof SyntaxError) {
      const def = getCode("E3021");
      return {
        kind: "invalid",
        diagnostics: [{
          code: "E3021",
          severity: def.severity,
          category: def.category,
          requestPath: "body",
          specPointer: "",
          message: `Invalid ${maybeMediaType} format: ${error.message}`,
          expected: `valid ${maybeMediaType}`,
          attribution: {
            confidence: 0.95,
            reasoning: [
              `Request body could not be parsed as ${maybeMediaType}`,
            ],
          },
          suggestion:
            "Ensure the request body is well-formed JSON or matches the declared content type",
        }],
      };
    }

    const def = getCode("E3021");
    return {
      kind: "invalid",
      diagnostics: [{
        code: "E3021",
        severity: def.severity,
        category: def.category,
        requestPath: "body",
        specPointer: "",
        message: `Failed to read request body: ${
          error instanceof Error ? error.message : String(error)
        }`,
        expected: "readable request body",
        attribution: {
          confidence: 0.8,
          reasoning: [
            "Request body could not be read from the stream",
          ],
        },
        suggestion: "Check the request encoding and content type",
      }],
    };
  }
}

interface FormBodyResult {
  body: unknown;
  rawFormKeys: string[];
}

/**
 * Parse form data body (multipart/form-data or application/x-www-form-urlencoded).
 *
 * @param contentTypeHeader - The raw header; multipart needs its boundary parameter.
 */
async function parseFormBody(
  bytes: Uint8Array<ArrayBuffer>,
  contentTypeHeader: string,
  mediaType: MultipartFormData | UrlEncoded,
  options?: FormParserOptions,
): Promise<FormBodyResult> {
  const parserOptions: FormParserOptions = {
    formArrayFormat: options?.formArrayFormat ?? "repeat",
    formObjectFormat: options?.formObjectFormat ?? "flat",
    schema: options?.schema,
    resolveSchema: options?.resolveSchema,
    partContentTypes: options?.partContentTypes,
  };

  if (isMultipartFormData(mediaType)) {
    // The platform's multipart decoder is reached through a body carrier.
    const formData = await new Response(bytes, {
      headers: { "Content-Type": contentTypeHeader },
    }).formData();
    const rawFormKeys = [...formData.keys()];
    const parsed = await parseFormData(formData, parserOptions);
    return { body: parsed.data, rawFormKeys };
  }

  // application/x-www-form-urlencoded
  const body = new TextDecoder().decode(bytes);
  const params = new URLSearchParams(body);
  const rawFormKeys = [...params.keys()];
  const parsed = parseUrlEncoded(body, parserOptions);
  return { body: parsed.data, rawFormKeys };
}
