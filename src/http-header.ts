/**
 * Encoding of text into HTTP response header values.
 *
 * A field value may only carry visible ASCII and spaces (RFC 9110 section
 * 5.5), and `Headers.set()` throws on anything it cannot represent. Text that
 * reaches a header in Steady can quote the request (a property name, a value,
 * the path) or the spec, so it can contain any character. This module is the
 * single outgoing boundary for such text: format here, never at the call site.
 */

const utf8 = new TextEncoder();

const PERCENT = 0x25;
const SPACE = 0x20;

/** Visible ASCII (VCHAR), without the space. */
function isVisibleAscii(byte: number): boolean {
  return byte > SPACE && byte < 0x7f;
}

function percentEncode(
  text: string,
  keep: (byte: number) => boolean,
  hex: (byte: number) => string,
): string {
  let encoded = "";
  for (const byte of utf8.encode(text)) {
    encoded += keep(byte) ? String.fromCharCode(byte) : `%${hex(byte)}`;
  }
  return encoded;
}

/**
 * Encode free text (a diagnostic message, a request location) as a header
 * value.
 *
 * Visible ASCII and spaces are kept. Every other byte of the UTF-8 form, and
 * the percent sign itself, is percent-encoded with lowercase hex, as in the
 * Display String of RFC 9651 section 3.3.8. The result is reversible:
 * `decodeURIComponent(value)` returns the original text.
 */
export function encodeHeaderText(text: string): string {
  return percentEncode(
    text,
    (byte) => (isVisibleAscii(byte) || byte === SPACE) && byte !== PERCENT,
    (byte) => byte.toString(16).padStart(2, "0"),
  );
}

/**
 * Encode a URI reference (e.g. a Location taken from the spec) as a header
 * value.
 *
 * A URI is ASCII only. Characters outside visible ASCII are percent-encoded
 * as UTF-8, which is the IRI to URI mapping of RFC 3987 section 3.1. Existing
 * percent-escapes and all URI delimiters are left as they are, so a reference
 * that is already a valid URI is returned unchanged.
 */
export function encodeUriReference(reference: string): string {
  return percentEncode(
    reference,
    isVisibleAscii,
    (byte) => byte.toString(16).toUpperCase().padStart(2, "0"),
  );
}
