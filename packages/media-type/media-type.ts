/**
 * Media type utilities built on @std/media-types.
 *
 * Provides a branded MediaTypeEssence type to prevent mixing up raw
 * Content-Type header values with parsed essences, and classification
 * functions following the WHATWG MIME Sniffing Standard.
 */

import { parseMediaType } from "@std/media-types/parse-media-type";

/** A parsed media type essence (e.g. "application/json"), not a raw header value. */
export type MediaTypeEssence = string & {
  readonly __brand: "MediaTypeEssence";
};

/** The essence of plain JSON. */
export const APPLICATION_JSON = "application/json" as MediaTypeEssence;

/** Wildcard media type from Accept headers. */
export type WildcardMediaType = MediaTypeEssence & "*/*";

/** Known form content types. */
export type MultipartFormData = MediaTypeEssence & "multipart/form-data";
export type UrlEncoded =
  & MediaTypeEssence
  & "application/x-www-form-urlencoded";

/** NDJSON content type variants. */
export type NdjsonMediaType =
  & MediaTypeEssence
  & (
    | "application/x-ndjson"
    | "application/ndjson"
    | "application/jsonl"
    | "application/x-jsonl"
    | "application/jsonlines"
    | "application/x-jsonlines"
    | "application/json-lines"
    | "application/x-ldjson"
    | "application/json-seq"
    | "text/x-ndjson"
  );

/** Server-Sent Events content type. */
export type SseMediaType = MediaTypeEssence & "text/event-stream";

/** Any streaming content type. */
export type StreamingMediaType = NdjsonMediaType | SseMediaType;

/**
 * Parse a Content-Type header value into its media type essence.
 * Strips parameters (charset, boundary, etc.) using the WHATWG MIME type parser.
 * Returns null if the input cannot be parsed.
 */
export function getMediaType(contentType: string): MediaTypeEssence | null {
  try {
    const [essence] = parseMediaType(contentType);
    return essence ? essence as MediaTypeEssence : null;
  } catch {
    return null;
  }
}

/**
 * Check if a media type essence is a JSON MIME type per the WHATWG MIME Sniffing Standard.
 * A JSON MIME type is any MIME type whose subtype ends in "+json"
 * or whose essence is "application/json" or "text/json".
 */
export function isJsonMediaType(essence: MediaTypeEssence): boolean {
  return essence === "application/json" ||
    essence === "text/json" ||
    essence.endsWith("+json");
}

/** Type guard for wildcard media type. */
export function isWildcard(
  essence: MediaTypeEssence,
): essence is WildcardMediaType {
  return essence === "*/*";
}

/**
 * Check if a candidate essence matches a pattern.
 *
 * The pattern may be a media range (RFC 9110 section 12.5.1): the full
 * wildcard matches any candidate, and a subtype wildcard such as "image/*"
 * matches any candidate of that type. OpenAPI allows media ranges as content
 * keys, so spec-side patterns use the same rule as Accept ranges.
 */
export function essenceMatches(
  candidate: MediaTypeEssence,
  pattern: MediaTypeEssence,
): boolean {
  if (candidate === pattern || isWildcard(pattern)) return true;
  if (!pattern.endsWith("/*")) return false;
  // Keep the slash so "image/*" does not match "imagex/png".
  return candidate.startsWith(pattern.slice(0, -1));
}

// ── Accept header (RFC 9110 section 12.5.1) ───────────────────────

/** One member of an Accept header: a media range and its weight. */
export interface AcceptEntry {
  /** A media type, a subtype wildcard ("text/*") or the full wildcard. */
  range: MediaTypeEssence;
  /** Weight from 0 to 1. A weight of 0 means "not acceptable". */
  q: number;
}

/**
 * A non-negative decimal. Wider than the qvalue grammar of RFC 9110 section
 * 12.4.2 on purpose: real clients send weights such as ".2" (Java's
 * HttpURLConnection) or "0.5000", and servers accept them.
 */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Read a weight parameter. Values above 1 count as 1. A value that is not a
 * non-negative decimal is ignored, which leaves the default weight of 1: a
 * client that names a media range wants it, whatever it wrote after "q=".
 */
function parseWeight(raw: string | undefined): number {
  if (raw === undefined || !DECIMAL.test(raw)) return 1;
  return Math.min(Number(raw), 1);
}

/** A media range has exactly one slash with a non-empty type and subtype. */
const MEDIA_RANGE = /^[^/]+\/[^/]+$/;

/**
 * Split a list header on commas, leaving commas inside quoted strings alone.
 */
function splitListHeader(header: string): string[] {
  const members: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const char = header.charAt(i);
    if (quoted && char === "\\") {
      // quoted-pair: the next character is literal
      current += char + header.charAt(i + 1);
      i++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      members.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  members.push(current);
  return members;
}

/** An Accept header value, parsed. */
export interface ParsedAccept {
  /** The media ranges the header names, in header order. */
  entries: AcceptEntry[];
  /**
   * True when no member of the header could be read as a media type at all
   * (e.g. ";;;"). A member such as "*" or "json" can be read, so it does not
   * make the header malformed, but it is not a type/subtype range and takes
   * no part in negotiation.
   */
  malformed: boolean;
}

/**
 * Parse an Accept header value.
 *
 * Parsing is lenient, like the servers an SDK talks to: a member that is not
 * a media range is skipped, and a weight that cannot be read is ignored.
 */
export function parseAccept(header: string): ParsedAccept {
  const entries: AcceptEntry[] = [];
  let readable = 0;
  for (const member of splitListHeader(header)) {
    let parsed: ReturnType<typeof parseMediaType>;
    try {
      parsed = parseMediaType(member.trim());
    } catch {
      continue;
    }
    const [range, params] = parsed;
    if (!range) continue;
    readable++;
    if (!MEDIA_RANGE.test(range)) continue;

    entries.push({
      range: range as MediaTypeEssence,
      q: parseWeight(params?.q),
    });
  }
  return { entries, malformed: readable === 0 };
}

/** 2 for a concrete type, 1 for a subtype wildcard, 0 for the full wildcard. */
function rangeSpecificity(range: MediaTypeEssence): number {
  if (isWildcard(range)) return 0;
  return range.endsWith("/*") ? 1 : 2;
}

/** True for the full wildcard and for subtype wildcards such as "image/*". */
export function isMediaRange(essence: MediaTypeEssence): boolean {
  return rangeSpecificity(essence) < 2;
}

/** Result of content negotiation. */
export interface NegotiatedMediaType {
  /** Index into the `available` list. */
  index: number;
  /**
   * The Accept range that selected it. When the available entry is itself a
   * range (an OpenAPI content key such as the full wildcard), this is the
   * client's more concrete wish.
   */
  range: MediaTypeEssence;
}

/**
 * Choose the available media type the client prefers.
 *
 * For each available entry the most specific overlapping Accept range decides
 * its weight (RFC 9110 section 12.5.1), so "text/plain;q=0" excludes
 * text/plain even next to a full wildcard. The highest weight wins. Equal
 * weights are ordered by position in the Accept header, then by position in
 * `available`. Returns null when nothing is acceptable.
 */
export function negotiateMediaType(
  accept: readonly AcceptEntry[],
  available: readonly MediaTypeEssence[],
): NegotiatedMediaType | null {
  let best: { index: number; entry: AcceptEntry; position: number } | null =
    null;

  for (const [index, candidate] of available.entries()) {
    const governing = governingEntry(accept, candidate);
    if (governing === null || governing.entry.q === 0) continue;

    if (
      best === null || governing.entry.q > best.entry.q ||
      (governing.entry.q === best.entry.q && governing.position < best.position)
    ) {
      best = { index, ...governing };
    }
  }

  return best === null ? null : { index: best.index, range: best.entry.range };
}

/**
 * The Accept member that decides a candidate's weight: the most specific
 * overlapping range, then the higher weight, then the earlier position.
 */
function governingEntry(
  accept: readonly AcceptEntry[],
  candidate: MediaTypeEssence,
): { entry: AcceptEntry; position: number } | null {
  let governing: { entry: AcceptEntry; position: number } | null = null;
  for (const [position, entry] of accept.entries()) {
    const overlaps = essenceMatches(candidate, entry.range) ||
      essenceMatches(entry.range, candidate);
    if (!overlaps) continue;
    if (governing === null) {
      governing = { entry, position };
      continue;
    }
    const delta = rangeSpecificity(entry.range) -
      rangeSpecificity(governing.entry.range);
    if (delta > 0 || (delta === 0 && entry.q > governing.entry.q)) {
      governing = { entry, position };
    }
  }
  return governing;
}

/** Type guard for multipart/form-data. */
export function isMultipartFormData(
  essence: MediaTypeEssence,
): essence is MultipartFormData {
  return essence === "multipart/form-data";
}

/** Type guard for application/x-www-form-urlencoded. */
export function isUrlEncoded(
  essence: MediaTypeEssence,
): essence is UrlEncoded {
  return essence === "application/x-www-form-urlencoded";
}

/** Type guard for any form content type. */
export function isFormMediaType(
  essence: MediaTypeEssence,
): essence is MultipartFormData | UrlEncoded {
  return isMultipartFormData(essence) || isUrlEncoded(essence);
}

/**
 * Check if a media type essence is a binary/opaque type.
 * These types carry raw bytes where the body should not be interpreted as text or JSON.
 */
export function isBinaryMediaType(essence: MediaTypeEssence): boolean {
  return essence === "application/octet-stream" ||
    essence.startsWith("image/") ||
    essence.startsWith("audio/") ||
    essence.startsWith("video/");
}

// ── Streaming media types ─────────────────────────────────────────

const NDJSON_TYPES: ReadonlySet<string> = new Set<NdjsonMediaType>([
  "application/x-ndjson" as NdjsonMediaType,
  "application/ndjson" as NdjsonMediaType,
  "application/jsonl" as NdjsonMediaType,
  "application/x-jsonl" as NdjsonMediaType,
  "application/jsonlines" as NdjsonMediaType,
  "application/x-jsonlines" as NdjsonMediaType,
  "application/json-lines" as NdjsonMediaType,
  "application/x-ldjson" as NdjsonMediaType,
  "application/json-seq" as NdjsonMediaType,
  "text/x-ndjson" as NdjsonMediaType,
]);

/** Type guard for NDJSON media types. */
export function isNdjsonMediaType(
  essence: MediaTypeEssence,
): essence is NdjsonMediaType {
  return NDJSON_TYPES.has(essence);
}

/** Type guard for Server-Sent Events. */
export function isSseMediaType(
  essence: MediaTypeEssence,
): essence is SseMediaType {
  return essence === "text/event-stream";
}

/** Type guard for any streaming content type (NDJSON or SSE). */
export function isStreamingMediaType(
  essence: MediaTypeEssence,
): essence is StreamingMediaType {
  return isNdjsonMediaType(essence) || isSseMediaType(essence);
}

/**
 * Get the streaming format for a media type essence.
 * Returns null if the essence is not a streaming type.
 */
export function getStreamingFormat(
  essence: MediaTypeEssence,
): "ndjson" | "sse" | null {
  if (isNdjsonMediaType(essence)) return "ndjson";
  if (isSseMediaType(essence)) return "sse";
  return null;
}
