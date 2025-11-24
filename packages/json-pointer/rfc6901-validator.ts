/**
 * RFC 6901 JSON Pointer Strict Validation
 * https://tools.ietf.org/html/rfc6901
 *
 * This module provides STRICT validation of JSON Pointer syntax according to RFC 6901.
 * The validation catches common errors that break interoperability.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Validate a JSON Pointer string according to RFC 6901
 *
 * RFC 6901 Requirements:
 * - Must start with "/" or be empty string
 * - Tilde (~) MUST be escaped as ~0
 * - Slash (/) MUST be escaped as ~1 when it's part of a token (not a separator)
 * - Invalid escape sequences (e.g., ~2, ~A) are NOT allowed
 * - Spaces SHOULD be percent-encoded as %20
 * - Other special characters CAN be percent-encoded
 */
export function validatePointer(pointer: string): ValidationResult {
  // Empty string is valid per RFC 6901
  if (pointer === "") {
    return { valid: true };
  }

  // Must start with "/"
  if (!pointer.startsWith("/")) {
    return {
      valid: false,
      error: "JSON Pointer must start with '/' or be empty string per RFC 6901",
      suggestion: `Add leading slash: "${pointer}" → "/${pointer}"`,
    };
  }

  // Check for invalid escape sequences and unescaped special characters
  const tokens = pointer.slice(1).split("/");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;

    const tokenValidation = validateToken(token, i);
    if (!tokenValidation.valid) {
      return {
        valid: false,
        error: `Invalid token at position ${i}: ${tokenValidation.error}`,
        suggestion: tokenValidation.suggestion,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a single JSON Pointer token (segment between slashes)
 */
function validateToken(token: string, _position: number): ValidationResult {
  // Check for invalid escape sequences
  // RFC 6901: Only ~0 (tilde) and ~1 (slash) are valid escape sequences

  let i = 0;
  while (i < token.length) {
    const char = token[i];

    if (char === "~") {
      // Found a tilde - must be followed by 0 or 1
      const nextChar = token[i + 1];

      if (nextChar === undefined) {
        // Tilde at end of token - invalid
        return {
          valid: false,
          error: `Unescaped tilde (~) at end of token`,
          suggestion: `Escape the tilde as ~0 per RFC 6901`,
        };
      }

      if (nextChar !== "0" && nextChar !== "1") {
        // Invalid escape sequence like ~2, ~A, ~/, etc.
        return {
          valid: false,
          error: `Invalid escape sequence "~${nextChar}" in token`,
          suggestion: `RFC 6901 only allows ~0 (for tilde) and ~1 (for slash). ` +
            `To use a literal tilde, escape it as ~0`,
        };
      }

      // Valid escape sequence, skip the next character
      i += 2;
    } else {
      i++;
    }
  }

  return { valid: true };
}

/**
 * Validate a $ref value (includes fragment identifier)
 *
 * Examples:
 * - "#/definitions/User" ✓
 * - "##/definitions/User" ✗ (double hash)
 * - "#/definitions/" ✗ (trailing slash with no token)
 * - "#components/schemas/User" ✗ (missing slash after #)
 */
export function validateRef(ref: string): ValidationResult {
  // Check for double hash (common typo)
  if (ref.startsWith("##")) {
    return {
      valid: false,
      error: "Reference starts with double hash (##)",
      suggestion: `Remove one hash: "${ref}" → "${ref.slice(1)}"`,
    };
  }

  // Check for missing hash (external refs are different)
  if (!ref.startsWith("#") && !ref.includes("://") && !ref.includes("/")) {
    return {
      valid: false,
      error: "Internal references must start with '#'",
      suggestion: `Add hash: "${ref}" → "#/${ref}"`,
    };
  }

  // Check for hash but missing slash
  if (ref.startsWith("#") && ref.length > 1 && !ref.startsWith("#/")) {
    // Could be an anchor reference like "#myAnchor" which is valid
    // But if it looks like a path, it's probably missing the slash
    if (ref.includes("/")) {
      return {
        valid: false,
        error: "Reference missing slash after hash",
        suggestion: `Add slash: "${ref}" → "${ref.replace("#", "#/")}"`,
      };
    }
    // Otherwise it's an anchor reference, which is valid
    return { valid: true };
  }

  // Check for external ref patterns that we don't support
  if (ref.includes("://") || ref.startsWith("file:")) {
    return {
      valid: false,
      error: "External references are not supported",
      suggestion: "Include the schema directly in your document using $defs",
    };
  }

  // Check for relative file paths (path without protocol that contains /)
  if (!ref.startsWith("#") && ref.includes("/")) {
    return {
      valid: false,
      error: "Relative file path references are not supported",
      suggestion: "Include the schema directly in your document using $defs",
    };
  }

  // Check for backslashes (Windows path separator)
  if (ref.includes("\\")) {
    return {
      valid: false,
      error: "Backslashes are not valid in JSON Pointers per RFC 6901",
      suggestion: `Replace backslashes with forward slashes: "${ref}" → "${ref.replace(/\\/g, "/")}"`,
    };
  }

  // Check for query strings
  if (ref.includes("?")) {
    return {
      valid: false,
      error: "Query strings are not valid in JSON Pointers per RFC 6901",
      suggestion: `Remove query string from reference`,
    };
  }

  // Check for multiple fragment identifiers
  const hashCount = (ref.match(/#/g) || []).length;
  if (hashCount > 1) {
    return {
      valid: false,
      error: "Multiple fragment identifiers (#) are not valid per RFC 6901",
      suggestion: "Use only one '#' at the start of the reference",
    };
  }

  // Check for trailing slash with no token after it
  if (ref.endsWith("/") && ref !== "#/") {
    return {
      valid: false,
      error: "Trailing slash in reference (empty token)",
      suggestion: `Remove trailing slash: "${ref}" → "${ref.slice(0, -1)}"`,
    };
  }

  // Check for unencoded spaces
  if (ref.includes(" ")) {
    return {
      valid: false,
      error: "Spaces must be percent-encoded as %20 per RFC 6901",
      suggestion: `Encode spaces: "${ref}" → "${ref.replace(/ /g, "%20")}"`,
    };
  }

  // If it's an internal ref, validate the pointer part
  if (ref.startsWith("#/")) {
    const pointer = ref.slice(1); // Remove the "#"
    return validatePointer(pointer);
  }

  return { valid: true };
}

/**
 * Check if a token contains special characters that need escaping
 */
export function needsEscaping(token: string): boolean {
  return token.includes("~") || token.includes("/");
}

/**
 * Get human-readable explanation of what's wrong with a ref
 */
export function explainInvalidRef(ref: string): string {
  const result = validateRef(ref);
  if (result.valid) {
    return "Reference is valid";
  }

  let explanation = `Invalid reference: "${ref}"\n\n`;
  explanation += `ERROR: ${result.error}\n`;
  if (result.suggestion) {
    explanation += `FIX: ${result.suggestion}\n`;
  }

  return explanation;
}
