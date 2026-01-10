/**
 * Format Expected Values - Convert JSON Schema keywords + params to human-readable strings
 */

/**
 * Format the expected value for a validation error into a human-readable string
 */
export function formatExpected(
  keyword: string,
  params?: Record<string, unknown>,
): string {
  switch (keyword) {
    // Type constraints
    case "type": {
      const types = params?.type;
      if (Array.isArray(types)) {
        return types.join(" | ");
      }
      return String(types || "unknown type");
    }

    case "const":
      return JSON.stringify(params?.allowedValue);

    case "enum": {
      const vals = params?.allowedValues as unknown[] | undefined;
      if (!vals || vals.length === 0) return "one of allowed values";
      if (vals.length <= 5) {
        return vals.map((v) => JSON.stringify(v)).join(" | ");
      }
      return `one of ${vals.length} values`;
    }

    // String constraints
    case "format":
      return `${params?.format} format`;

    case "minLength":
      return `at least ${params?.limit} characters`;

    case "maxLength":
      return `at most ${params?.limit} characters`;

    case "pattern":
      return `matching /${params?.pattern}/`;

    // Number constraints
    case "minimum":
      return `>= ${params?.limit}`;

    case "maximum":
      return `<= ${params?.limit}`;

    case "exclusiveMinimum":
      return `> ${params?.limit}`;

    case "exclusiveMaximum":
      return `< ${params?.limit}`;

    case "multipleOf":
      return `multiple of ${params?.multipleOf}`;

    // Array constraints
    case "minItems":
      return `at least ${params?.limit} items`;

    case "maxItems":
      return `at most ${params?.limit} items`;

    case "uniqueItems":
      return "unique items";

    case "contains":
      return "containing at least one matching item";

    case "minContains":
      return `containing at least ${params?.limit} matching items`;

    case "maxContains":
      return `containing at most ${params?.limit} matching items`;

    // Object constraints
    case "required":
      return `required field "${params?.missingProperty}"`;

    case "additionalProperties":
      return `no additional properties (found "${params?.additionalProperty}")`;

    case "unevaluatedProperties":
      return `no unevaluated properties (found "${params?.unevaluatedProperty}")`;

    case "minProperties":
      return `at least ${params?.limit} properties`;

    case "maxProperties":
      return `at most ${params?.limit} properties`;

    case "propertyNames":
      return "valid property names";

    case "dependentRequired":
      return `property "${params?.missingProperty}" (required when "${params?.property}" is present)`;

    // Composition
    case "oneOf": {
      const passing = params?.passingSchemas as number | undefined;
      if (passing === 0) {
        return "matching exactly one variant";
      }
      return `matching exactly one variant (matched ${passing})`;
    }

    case "anyOf":
      return "matching at least one variant";

    case "allOf":
      return "matching all variants";

    case "not":
      return "NOT matching the forbidden schema";

    // Reference
    case "$ref":
      return `matching referenced schema ${params?.$ref}`;

    // Boolean schemas
    case "false":
      return "never valid (schema is false)";

    // Fallback
    default:
      if (params?.message) {
        return String(params.message);
      }
      return keyword;
  }
}

/**
 * Format the actual value for display, truncating if necessary
 */
export function formatActual(value: unknown, maxLength = 50): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  try {
    const str = JSON.stringify(value);
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength - 3) + "...";
  } catch {
    return String(value);
  }
}

/**
 * Format a validation error path from JSON pointer format to dot notation
 * e.g., "/body/user/email" -> "body.user.email"
 * e.g., "/body/items/0/name" -> "body.items[0].name"
 */
export function formatPath(instancePath: string): string {
  if (!instancePath || instancePath === "") return "root";

  return instancePath
    .split("/")
    .filter(Boolean)
    .map((segment, index) => {
      // Unescape JSON pointer encoding
      const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");

      // Check if this is an array index
      if (/^\d+$/.test(unescaped)) {
        return `[${unescaped}]`;
      }

      // Check if property name needs quoting (contains dots or special chars)
      if (/[.\[\]"]/.test(unescaped)) {
        return `["${unescaped.replace(/"/g, '\\"')}"]`;
      }

      // Regular property name
      if (index === 0) {
        return unescaped;
      }
      return `.${unescaped}`;
    })
    .join("")
    .replace(/\.\[/g, "["); // Fix array notation: .[ -> [
}
