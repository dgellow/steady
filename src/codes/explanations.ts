/**
 * E-code explanations: detailed documentation for `steady explain`.
 *
 * Each explanation is written from the user's perspective: what happened,
 * why it matters, a concrete example, and what to do about it.
 *
 * The registry has metadata (title, severity, category).
 * This file has documentation (multi-line prose).
 */

import type { ECode } from "./registry.ts";

/**
 * Detailed explanation for a single E-code.
 */
export interface Explanation {
  /** Plain-language description of what this diagnostic means. */
  description: string;
  /** Why Steady categorizes it this way. */
  reasoning: string;
  /** Concrete example showing the problem. */
  example: string;
  /** What the user should do about it. */
  fix: string;
  /** Related E-codes the user should also know about. */
  seeAlso?: ECode[];
}

const EXPLANATIONS: Record<ECode, Explanation> = {
  // ── E1xxx: Spec Issues ──────────────────────────────────────────────

  E1001: {
    description: "The spec file could not be parsed as valid YAML or JSON.\n" +
      "This usually means a syntax error like a missing comma, unclosed\n" +
      "bracket, or invalid YAML indentation.",
    reasoning:
      "This is a spec issue. The file itself is malformed before Steady\n" +
      "can even read the API definition.",
    example:
      '  paths:\n    /users:\n      get:\n        summary: "List users"\n' +
      "        responses:     # <-- missing value here\n" +
      "          200",
    fix:
      "Run your spec through a YAML/JSON linter to find the syntax error.\n" +
      "Most editors with OpenAPI plugins will highlight it.",
  },

  E1002: {
    description:
      "The spec declares an OpenAPI version that Steady doesn't support.\n" +
      "Steady supports OpenAPI 3.0.x and 3.1.x. Swagger 2.0 and earlier\n" +
      "versions are not supported.",
    reasoning:
      "This is a spec issue. The version declaration is outside the\n" +
      "range Steady can work with.",
    example: '  openapi: "2.0.0"    # Swagger 2.0, not supported\n' +
      '  openapi: "3.1.0"    # Supported\n' +
      '  openapi: "3.0.3"    # Supported',
    fix: "If you have a Swagger 2.0 spec, convert it to OpenAPI 3.x using\n" +
      "swagger2openapi or the Swagger Editor's converter.",
  },

  E1003: {
    description:
      "The spec is missing a required top-level field like `openapi`,\n" +
      "`info.title`, or `info.version`. Steady fills in defaults and\n" +
      "continues, but the spec should be fixed.",
    reasoning:
      "This is a spec issue. These fields are required by the OpenAPI\n" +
      "specification. Steady is lenient here but other tools may reject it.",
    example: "  # Missing info.title:\n" +
      "  openapi: 3.1.0\n" +
      "  info:\n" +
      '    version: "1.0"',
    fix: "Add the missing field to your spec.",
  },

  E1004: {
    description: "A $ref points to a path that doesn't exist in the spec.\n" +
      "Steady cannot resolve the reference and cannot serve endpoints\n" +
      "that depend on it.",
    reasoning:
      "This is a spec issue. The reference target is missing. This is\n" +
      "fatal because Steady needs the referenced schema to validate\n" +
      "requests and generate responses.",
    example: "  schema:\n" +
      '    $ref: "#/components/schemas/UserResponse"\n' +
      "  # but UserResponse doesn't exist in components/schemas",
    fix: "Check the $ref path for typos. Common mistakes: wrong casing\n" +
      "(userResponse vs UserResponse), wrong nesting level, or a schema\n" +
      "that was renamed but the reference wasn't updated.",
    seeAlso: ["E1005"],
  },

  E1005: {
    description:
      "The spec contains a circular $ref chain (A references B, B\n" +
      "references A). Steady handles most circular references but they\n" +
      "may cause issues with response generation.",
    reasoning:
      "This is a spec issue. While circular references are technically\n" +
      "allowed in OpenAPI 3.1, they often indicate a modeling problem\n" +
      "and can cause issues with code generators and other tools.",
    example: "  # Parent references Child, Child references Parent:\n" +
      "  Parent:\n" +
      "    properties:\n" +
      "      children:\n" +
      "        type: array\n" +
      "        items:\n" +
      '          $ref: "#/components/schemas/Child"\n' +
      "  Child:\n" +
      "    properties:\n" +
      "      parent:\n" +
      '        $ref: "#/components/schemas/Parent"',
    fix: "Break the cycle by making one side of the reference optional or\n" +
      "using a simpler inline schema for one direction.",
    seeAlso: ["E1004"],
  },

  E1006: {
    description:
      "A schema in the spec violates the JSON Schema or OpenAPI meta-\n" +
      "schema rules so severely that Steady cannot interpret it. This\n" +
      "is distinct from E1015 (non-standard but tolerable usage).",
    reasoning:
      "This is a spec issue and it's fatal. Steady relies on schema\n" +
      "structure for validation and response generation. A fundamentally\n" +
      "broken schema cannot be used.",
    example: "  # type must be a string (or array in 3.1), not an object:\n" +
      "  properties:\n" +
      "    name:\n" +
      "      type:\n" +
      "        kind: string",
    fix: "Fix the schema to conform to JSON Schema / OpenAPI rules.\n" +
      "Run your spec through an OpenAPI linter for detailed guidance.",
    seeAlso: ["E1015"],
  },

  E1007: {
    description:
      "In OpenAPI 3.0, keywords placed alongside a $ref are silently\n" +
      "ignored per the JSON Reference specification. Only the $ref is\n" +
      "processed. Sibling keywords like description, nullable, or\n" +
      "additional properties have no effect.",
    reasoning: "This is a spec issue. The spec author likely intended those\n" +
      "sibling keywords to take effect, but they're invisible to any\n" +
      "compliant 3.0 parser. In OpenAPI 3.1 (which uses JSON Schema),\n" +
      "$ref siblings ARE processed.",
    example: "  # In OpenAPI 3.0, the description below is ignored:\n" +
      "  schema:\n" +
      '    $ref: "#/components/schemas/User"\n' +
      '    description: "Extended user with avatar"  # ignored!\n' +
      "    nullable: true                            # also ignored!",
    fix: "Use allOf to compose the $ref with additional keywords:\n" +
      "  schema:\n" +
      "    allOf:\n" +
      '      - $ref: "#/components/schemas/User"\n' +
      "      - description: Extended user\n" +
      "Or upgrade to OpenAPI 3.1 where $ref siblings work natively.",
  },

  E1008: {
    description:
      "Two or more path templates resolve to the same pattern. For\n" +
      "example, /users/{id} and /users/{userId} are different templates\n" +
      "but match the same requests, making routing ambiguous.",
    reasoning: "This is a spec issue. OpenAPI requires path templates to be\n" +
      "unique after parameter substitution. Which operation handles\n" +
      "a request to /users/123 is undefined.",
    example: "  paths:\n" +
      "    /users/{id}:       # matches /users/123\n" +
      "      get: ...\n" +
      "    /users/{userId}:   # also matches /users/123\n" +
      "      get: ...",
    fix: "Remove the duplicate path. If you need different behavior based\n" +
      "on the parameter, use a single path template with conditional\n" +
      "logic in the operation.",
    seeAlso: ["E1009"],
  },

  E1009: {
    description:
      "A path template uses the same parameter name more than once.\n" +
      "For example, /users/{id}/posts/{id} uses {id} twice. Which\n" +
      "value wins is undefined; typically the last one overwrites.",
    reasoning:
      "This is a spec issue. Parameter names must be unique within a\n" +
      "path template per the OpenAPI spec. Common cause: auto-generated\n" +
      "specs from ORMs that nest resources.",
    example: "  paths:\n" +
      "    /users/{id}/posts/{id}:    # {id} used twice\n" +
      "      get:\n" +
      "        parameters:\n" +
      "          - name: id           # which {id}?\n" +
      "            in: path",
    fix: "Use distinct parameter names: /users/{userId}/posts/{postId}",
    seeAlso: ["E1008"],
  },

  E1010: {
    description:
      "An operation has no responses object defined. Steady returns\n" +
      "204 No Content for these endpoints. The diagnostic appears at\n" +
      "startup and alongside any runtime request validation results.",
    reasoning:
      "This is a spec issue. The responses object is required by the\n" +
      "OpenAPI spec. Missing responses hide coverage gaps: a passing\n" +
      "SDK test might just mean the endpoint has no schema to validate\n" +
      "against, not that the SDK is correct.",
    example: "  paths:\n" +
      "    /users:\n" +
      "      post:\n" +
      "        summary: Create user\n" +
      "        # no responses defined, Steady returns 204",
    fix: "Add at least one response (typically 200 or 201) with a schema\n" +
      "describing what the API returns.",
  },

  E1011: {
    description:
      "A component name contains characters that the OpenAPI spec\n" +
      "forbids. Names must match ^[a-zA-Z0-9.\\-_]+$: no spaces,\n" +
      "no special characters. Steady handles these via percent-encoded\n" +
      "$refs, but code generators will likely produce invalid output.",
    reasoning:
      "This is a spec issue. While Steady resolves these references\n" +
      "correctly, tools like openapi-generator will produce broken code\n" +
      "(e.g., `interface Api Response` with a space).",
    example: "  components:\n" +
      "    schemas:\n" +
      '      "Api Response":    # space in name, forbidden\n' +
      "        type: object\n" +
      '      "User[Admin]":     # brackets, forbidden\n' +
      "        type: object",
    fix: "Rename the component to use only alphanumeric characters, dots,\n" +
      "hyphens, and underscores: ApiResponse, User-Admin, user_admin.",
  },

  E1012: {
    description:
      "A schema is syntactically valid but logically impossible to\n" +
      "satisfy. No value could ever pass validation against it.",
    reasoning:
      "This is a spec issue. The schema's constraints contradict each\n" +
      "other. SDKs cannot produce valid data for an impossible schema,\n" +
      "so any validation failure against it is meaningless.",
    example:
      "  # Type conflict in allOf, no value is both string and number:\n" +
      "  allOf:\n" +
      "    - type: string\n" +
      "    - type: number\n\n" +
      "  # Range inversion, no number satisfies both:\n" +
      "  type: integer\n" +
      "  minimum: 100\n" +
      "  maximum: 5",
    fix: "Review the schema's composition. If using allOf, check that\n" +
      "merged schemas don't conflict on type, enum values, or numeric\n" +
      "ranges. If using oneOf, make sure at least one variant is\n" +
      "satisfiable.",
  },

  E1013: {
    description:
      "A path template in the spec contains multiple ? characters.\n" +
      "Only the first ? starts the query string. Subsequent ? become\n" +
      "literal characters in parameter values, almost certainly not\n" +
      "what was intended.",
    reasoning:
      "This is a spec issue. It usually means a URL construction bug\n" +
      "was baked into the spec's path definitions. For example, someone\n" +
      "concatenated query parameters with ? instead of &.",
    example: "  paths:\n" +
      "    /v1/models?beta=true?limit=10:\n" +
      "    #                   ^ should be &",
    fix: "Replace the second ? with & to properly separate query\n" +
      "parameters: /v1/models?beta=true&limit=10\n" +
      "Or better, define query parameters as parameter objects.",
    seeAlso: ["E1014"],
  },

  E1014: {
    description:
      "A query parameter name or enum value contains a ? character.\n" +
      "Since ? is the URL query delimiter, this creates ambiguity.\n" +
      "some HTTP libraries will percent-encode it, others won't.",
    reasoning: "This is a spec issue. The ? character in parameter names is\n" +
      "a source of interoperability problems across HTTP libraries.\n" +
      "Common in Ruby-style boolean conventions (is_valid?).",
    example: "  parameters:\n" +
      "    - name: active?        # ? in parameter name\n" +
      "      in: query\n" +
      "      schema:\n" +
      "        type: boolean",
    fix: "Rename the parameter to avoid ?: is_active, active, isActive.",
    seeAlso: ["E1013"],
  },

  E1015: {
    description:
      "The spec uses a keyword that's not recognized at this location\n" +
      "according to the OpenAPI metaschema. Steady ignores unrecognized\n" +
      "keywords and serves the spec normally.",
    reasoning:
      "This is a spec note. It doesn't affect Steady's behavior, but\n" +
      "other OpenAPI tools may reject the spec. Common examples:\n" +
      "unevaluatedProperties in places the spec doesn't expect it,\n" +
      "or vendor extensions in non-extension positions.",
    example: "  components:\n" +
      "    schemas:\n" +
      "      Pet:\n" +
      "        type: object\n" +
      "        unevaluatedProperties: false  # not recognized here",
    fix: "You can safely ignore this if Steady is your only consumer.\n" +
      "If you need to pass other OpenAPI validators, remove or relocate\n" +
      "the unrecognized keyword.",
    seeAlso: ["E1006"],
  },

  E1016: {
    description:
      "A schema lists a field in `required` that doesn't appear in\n" +
      "`properties`. This means the schema demands a field but never\n" +
      "defines its type or constraints. SDKs and code generators won't\n" +
      "know what type to use for the required field.",
    reasoning: "This is a spec issue. The required array references a field\n" +
      "name that has no matching property definition. It's almost always\n" +
      "a typo or a leftover from a rename.",
    example: "  User:\n" +
      "    type: object\n" +
      "    required: [name, email]\n" +
      "    properties:\n" +
      "      name:\n" +
      "        type: string\n" +
      "      # 'email' is required but not defined in properties",
    fix: "Either add the missing property to the properties object, or\n" +
      "remove it from the required array if it's no longer needed.",
    seeAlso: ["E1012"],
  },

  // ── E2xxx: Routing ──────────────────────────────────────────────────

  E2001: {
    description:
      "The SDK sent a request to a URL path that doesn't match any\n" +
      "operation in the spec. Steady checked every path template and\n" +
      "none matched.",
    reasoning: "This is an SDK issue. The SDK constructs the URL, so a path\n" +
      "that doesn't exist in the spec means the SDK built it wrong.\n" +
      "Common causes: wrong base path, URL encoding issues, or a\n" +
      "double-? bug where query parameters are joined with ? instead\n" +
      "of &.",
    example:
      '  # Spec defines: /v1/users/{id}\n  # SDK sends:    GET /v2/users/123     (wrong version prefix)\n  # SDK sends:    GET /v1/user/123      (typo: "user" not "users")',
    fix: "Compare the SDK's URL construction with the spec's path\n" +
      "templates. Check the base URL, path segments, and any version\n" +
      "prefixes. If the diagnostic shows a double-? pattern, the SDK\n" +
      "is likely appending ?params to a URL that already has a query\n" +
      "string.",
    seeAlso: ["E2002", "E1013"],
  },

  E2002: {
    description:
      "The path matched an operation in the spec, but the HTTP method\n" +
      "is not defined for that path. For example, the SDK sent a PUT\n" +
      "but the spec only defines GET and POST for that path.",
    reasoning:
      "This is an SDK issue. The SDK chose the wrong HTTP method for\n" +
      "this endpoint. The path is correct, so the SDK knows about the\n" +
      "resource but is using the wrong verb.",
    example: "  # Spec defines: GET /users, POST /users\n" +
      "  # SDK sends:    PUT /users          (PUT not defined)\n" +
      "  # SDK sends:    DELETE /users/123   (DELETE not defined for this path)",
    fix: "Check the SDK's method mapping for this endpoint. The suggestion\n" +
      "in the diagnostic will list the allowed methods.",
    seeAlso: ["E2001"],
  },

  // ── E3xxx: Transport / Structural ───────────────────────────────────

  E3001: {
    description:
      "A path parameter has the wrong type. The spec says the parameter\n" +
      "should be one type (e.g., integer) but the SDK sent another\n" +
      "(e.g., a non-numeric string).",
    reasoning:
      "This is an SDK issue. Path parameters are part of the URL, and\n" +
      "the SDK constructs the URL. If the spec says {id} is an integer\n" +
      'and the SDK puts "abc" there, the SDK has a type mapping bug.',
    example: "  # Spec: /users/{id} where id is type: integer\n" +
      '  # SDK sends: GET /users/abc    ("abc" is not an integer)',
    fix: "Check how the SDK serializes this path parameter. It should\n" +
      "convert the value to the type the spec declares.",
    seeAlso: ["E3003", "E3008"],
  },

  E3002: {
    description:
      "A required query parameter is missing from the request. The\n" +
      "spec marks it as required but the SDK didn't include it.",
    reasoning:
      "This is an SDK issue. A well-designed SDK should either require\n" +
      "this parameter in its API or provide a documented default. If\n" +
      "neither happens, the SDK's parameter handling is incomplete.",
    example: "  # Spec requires: ?page=N\n" +
      "  # SDK sends: GET /users          (no page parameter)\n" +
      "  # Should be: GET /users?page=1",
    fix: "Ensure the SDK includes all required query parameters. Check\n" +
      "whether the SDK's method signature exposes this parameter.",
    seeAlso: ["E3004", "E3005"],
  },

  E3003: {
    description:
      "A query parameter has the wrong type. The spec says it should\n" +
      "be one type (e.g., integer) but the SDK sent another.",
    reasoning:
      "This is an SDK issue. The SDK controls how query parameters are\n" +
      "serialized into the URL. If the spec says `limit` is an integer\n" +
      "and the SDK sends ?limit=abc, the SDK's serialization is wrong.",
    example: "  # Spec: limit is type: integer\n" +
      "  # SDK sends: ?limit=ten     (string, not integer)\n" +
      "  # Should be: ?limit=10",
    fix: "Check the SDK's query parameter serialization for this type.\n" +
      "Also check array format: if the spec expects comma-separated\n" +
      "but the SDK sends repeated params, types may not match.",
    seeAlso: ["E3001", "E3008"],
  },

  E3004: {
    description:
      "A required header is missing from the request. The spec marks\n" +
      "it as required but the SDK didn't send it.",
    reasoning:
      "This is an SDK issue. The SDK controls which headers are sent.\n" +
      "Required headers must always be included, either from user input\n" +
      "or SDK defaults.",
    example: "  # Spec requires: X-Api-Version header\n" +
      "  # SDK sends request without X-Api-Version",
    fix: "Ensure the SDK sets all required headers. If the header has a\n" +
      "fixed value (like an API version), the SDK should set it\n" +
      "automatically.",
    seeAlso: ["E3002", "E3005"],
  },

  E3005: {
    description: "The operation requires a request body, but the SDK sent a\n" +
      "request with no body (or an empty body).",
    reasoning: "This is an SDK issue. The SDK decides whether to include a\n" +
      "body. If the spec says the body is required, the SDK must\n" +
      "always send one.",
    example: "  # Spec: POST /users with required requestBody\n" +
      "  # SDK sends: POST /users with no body\n" +
      '  # Should be: POST /users with {"name": "..."}',
    fix: "Check the SDK's request body handling. The method should either\n" +
      "require body data or have a clear error when it's missing.",
    seeAlso: ["E3006", "E3007"],
  },

  E3006: {
    description:
      "The request's Content-Type header doesn't match any media type\n" +
      "the spec defines for this operation's request body.",
    reasoning: "This is an SDK issue. The SDK sets the Content-Type header.\n" +
      "If the spec says application/json but the SDK sends text/plain\n" +
      "or multipart/form-data, the SDK is packaging the body wrong.",
    example: "  # Spec accepts: application/json\n" +
      "  # SDK sends:    Content-Type: application/x-www-form-urlencoded\n" +
      "  # SDK sends:    Content-Type: text/plain",
    fix: "Check the SDK's Content-Type selection logic. It should match\n" +
      "one of the media types listed in the spec's requestBody.content.",
    seeAlso: ["E3005", "E3018"],
  },

  E3007: {
    description:
      "A field marked as required in the schema is missing from the\n" +
      "request body.",
    reasoning:
      "This is an SDK issue with medium confidence. If the SDK controls\n" +
      "the object structure, it should include all required fields.\n" +
      "However, if the field is user-supplied data that the SDK passes\n" +
      "through, the root cause may be incomplete test data rather than\n" +
      "an SDK bug.",
    example: "  # Spec: User requires [name, email]\n" +
      '  # SDK sends: {"name": "Alice"}     (missing email)\n' +
      '  # Should be: {"name": "Alice", "email": "alice@example.com"}',
    fix: "If the SDK constructs this object, add the missing field.\n" +
      "If the field comes from user input, ensure the SDK's type\n" +
      "system requires it (e.g., non-optional parameter).",
    seeAlso: ["E3005", "E3008"],
  },

  E3008: {
    description:
      "A field in the request body has the wrong type. The spec says\n" +
      "one type (e.g., string) but the SDK sent another (e.g., number).",
    reasoning:
      "This is an SDK issue. The SDK controls serialization. When the\n" +
      'spec says "type: string" and the SDK sends a number, the SDK\'s\n' +
      "type mapping is wrong. This is true even if the developer passed\n" +
      "a number, the SDK should enforce or convert types.",
    example: "  # Spec: email is type: string\n" +
      '  # SDK sends: {"email": 12345}      (number, not string)\n' +
      '  # Should be: {"email": "user@example.com"}',
    fix: "Check the SDK's type mapping for this field. The SDK should\n" +
      "either enforce the type at its API boundary or convert during\n" +
      "serialization.",
    seeAlso: ["E3001", "E3010"],
  },

  E3009: {
    description:
      "The request body contains a property that the schema doesn't\n" +
      "allow. The schema has additionalProperties: false and the SDK\n" +
      "sent a field not listed in properties.",
    reasoning:
      "This is an SDK issue, but with low confidence. Often this is a\n" +
      "serialization format mismatch rather than a true extra property.\n" +
      "For example, the SDK sends items[] (bracket notation) but the\n" +
      "spec expects items. Same data, different encoding.\n\n" +
      "It can also indicate an allOf + additionalProperties pitfall in\n" +
      "the spec. When that's detected, Steady re-attributes this to\n" +
      "spec-issue.",
    example:
      '  # True extra property:\n  # Spec allows: {name, email}\n  # SDK sends: {"name": "Alice", "email": "a@b.com", "age": 30}\n  #                                                    ^^^ not in schema\n\n  # Serialization mismatch:\n  # Spec expects: items (array)\n  # SDK sends: items[] = a, items[] = b',
    fix: "If the SDK is sending a genuinely extra field, remove it.\n" +
      "If it looks like a serialization issue (brackets, dots), check\n" +
      "the SDK's object/array encoding settings.\n" +
      "If the spec uses allOf + additionalProperties: false, the spec\n" +
      "may need restructuring.",
    seeAlso: ["E5003", "E3012"],
  },

  E3010: {
    description:
      "An item in an array has the wrong type. The spec's items schema\n" +
      "expects one type but the SDK sent another.",
    reasoning: "This is an SDK issue. The SDK controls how array items are\n" +
      "serialized. If the spec says items are strings and the SDK\n" +
      "sends numbers, the SDK's array serialization is wrong.",
    example: "  # Spec: tags is array of strings\n" +
      '  # SDK sends: {"tags": ["valid", 123, true]}\n' +
      "  #                      ok       ^^^ wrong type",
    fix: "Check how the SDK serializes array items for this field.\n" +
      "Each item should match the schema's items type.",
    seeAlso: ["E3008", "E4005"],
  },

  E3011: {
    description:
      "A discriminator value doesn't match any of the expected mapping\n" +
      "keys. The spec uses a discriminator to determine which variant\n" +
      "of a oneOf/anyOf applies, but the SDK sent an unrecognized value.",
    reasoning:
      "This is an SDK issue with medium confidence. If the SDK provides\n" +
      "typed discriminator options (e.g., Type.CAT, Type.DOG), a wrong\n" +
      "value means the SDK's type enum is stale. If the value comes\n" +
      "from user input, it could be test data.",
    example: '  # Spec discriminator: petType with values ["cat", "dog"]\n' +
      '  # SDK sends: {"petType": "fish"}   ("fish" not in mapping)',
    fix: "Check the SDK's discriminator value mapping. If using a typed\n" +
      "enum, verify it includes all variants from the spec.",
    seeAlso: ["E3016"],
  },

  E3012: {
    description:
      "The request body doesn't match the expected schema composition\n" +
      "(oneOf, anyOf, or allOf). None of the expected variants matched,\n" +
      "or multiple matched when exactly one was required (oneOf).",
    reasoning:
      "This is ambiguous by default. Schema composition failures are\n" +
      "hard to attribute because the mismatch could be in the SDK's\n" +
      "serialization, the test data, or the spec's composition design.\n" +
      "When all oneOf variants fail due to missing required fields,\n" +
      "it's unclear who's responsible.",
    example: "  # Spec: oneOf [CreditCard, BankTransfer]\n" +
      "  # CreditCard requires: cardNumber, expiry\n" +
      "  # BankTransfer requires: accountNumber, routing\n" +
      '  # SDK sends: {"cardNumber": "4111..."}   (missing expiry, no variant matches)',
    fix: "Look at which variant the SDK intended to match, then check\n" +
      "what's missing. If the composition is complex, the spec might\n" +
      "benefit from a discriminator to make matching explicit.",
    seeAlso: ["E3009", "E3011"],
  },

  E3013: {
    description:
      "A field is marked as required inside a schema that is itself an\n" +
      "optional property of a parent object. If the parent field is\n" +
      "omitted entirely, the required constraint is moot. But if the\n" +
      "parent is present, the nested field becomes mandatory.",
    reasoning:
      "This is ambiguous. The SDK might intentionally omit the parent\n" +
      "object (in which case the required field is irrelevant), or it\n" +
      "might include the parent but forget the nested required field.\n" +
      "Steady can't determine which scenario the SDK intended.",
    example: "  # address is optional, but if present, street is required:\n" +
      "  User:\n" +
      "    properties:\n" +
      "      address:                # optional parent\n" +
      "        type: object\n" +
      "        required: [street]    # required child\n" +
      "        properties:\n" +
      "          street: { type: string }",
    fix: "If the SDK includes the parent object, make sure all its\n" +
      "required fields are present. If the parent is optional, consider\n" +
      "whether omitting it entirely is the correct approach.",
    seeAlso: ["E3007"],
  },

  E3014: {
    description:
      "A query parameter was sent with a different serialization format\n" +
      "than the spec expects. The base parameter name is recognized, but\n" +
      "the format differs. For example, the SDK sent `items[]` (bracket style)\n" +
      "but the spec defines `items` (expecting comma or repeat style).",
    reasoning: "This is an SDK issue. The SDK chose the wrong serialization\n" +
      "format for this parameter. The parameter name is correct (the\n" +
      "base name matches), so the intent is clear, but the encoding\n" +
      "doesn't match what the spec expects.",
    example: "  # Spec defines: items (type: array, style: form)\n" +
      "  # SDK sends:    ?items[]=a&items[]=b  (bracket notation)\n" +
      "  # Expected:     ?items=a&items=b      (repeat style)\n" +
      "  #           or: ?items=a,b            (comma style)",
    fix: "Check the SDK's query parameter serialization format. The spec\n" +
      "expects a specific style. Check the parameter's style/explode\n" +
      "settings, or use Steady's --validator-query-array-format flag.",
    seeAlso: ["E3002", "E3003", "E3015"],
  },

  E3015: {
    description:
      "The SDK sent a query parameter that isn't defined in the spec\n" +
      "for this operation. The parameter name doesn't match any declared\n" +
      "query parameter, even after accounting for common serialization\n" +
      "format variations.",
    reasoning: "This is ambiguous. The extra parameter could be:\n" +
      "  - An SDK bug: the SDK is sending a parameter that doesn't exist\n" +
      "  - A spec gap: the spec forgot to declare this parameter\n" +
      "  - A framework artifact: debug_mode, _timestamp, etc.\n" +
      "Steady can't determine which, so it's informational.",
    example: "  # Spec defines query parameters: page, limit\n" +
      "  # SDK sends: ?page=1&limit=10&debug_mode=true\n" +
      "  #                              ^^^^^^^^^^^ not in spec",
    fix: "If the parameter is intentional, add it to the spec. If it's\n" +
      "a framework artifact or debugging parameter, you can ignore this.\n" +
      "If the SDK shouldn't send it, remove it from the request.",
    seeAlso: ["E3014", "E3002"],
  },

  E3016: {
    description:
      "The SDK sent a value not in the schema's enum list. Enum values\n" +
      "are structural. A well-designed SDK exposes typed options (e.g.,\n" +
      "Status.ACTIVE) rather than accepting free-form strings.",
    reasoning:
      "This is an SDK issue. The SDK should constrain enum inputs to\n" +
      "the values the spec declares. If the SDK sends an unknown value,\n" +
      "its input validation or type system is incomplete.",
    example: '  # Spec: status enum ["active", "inactive", "pending"]\n' +
      '  # SDK sends: {"status": "deleted"}   ("deleted" not in enum)',
    fix: "Check the SDK's enum type for this field. It should only allow\n" +
      "values defined in the spec. If the spec's enum is missing a\n" +
      "valid value, update the spec.",
    seeAlso: ["E3017", "E3011"],
  },

  E3017: {
    description:
      "The SDK sent a value that doesn't match a const constraint.\n" +
      "Const values are fixed by the spec. The SDK should set them\n" +
      "automatically, not rely on user input.",
    reasoning:
      "This is an SDK issue. Const values are typically discriminator\n" +
      "fields, API version headers, or fixed identifiers. The SDK\n" +
      "should hardcode these, not expose them as user-configurable.",
    example: '  # Spec: apiVersion const "2024-01-01"\n' +
      '  # SDK sends: {"apiVersion": "2023-06-01"}   (wrong version)',
    fix: "The SDK should automatically set const values. Check where this\n" +
      "value is configured and ensure it matches the spec's const.",
    seeAlso: ["E3016"],
  },

  E3018: {
    description:
      "The SDK used the wrong encoding for a field with a format like\n" +
      "binary or byte. These are encoding instructions, not value\n" +
      "validators. Binary means a binary stream, byte means base64.",
    reasoning: "This is an SDK issue with high confidence. Encoding formats\n" +
      "(binary, byte) tell the SDK HOW to encode data. This is\n" +
      "fundamentally different from value-validation formats (email,\n" +
      "uri) which are E4001. If the SDK sends plain text when the spec\n" +
      "says format: binary, the SDK used the wrong encoding.",
    example: "  # Spec: avatar is type: string, format: byte (base64)\n" +
      '  # SDK sends: raw binary data instead of base64-encoded string\n  # Should be: "iVBORw0KGgo..."',
    fix: "Check the SDK's encoding logic for this format. binary = send\n" +
      "as-is in multipart, byte = base64 encode.",
    seeAlso: ["E4001"],
  },

  // ── E4xxx: Content Validation Notes ─────────────────────────────────

  E4001: {
    description:
      "A value doesn't match a value-validation format like email, uri,\n" +
      "uuid, or date-time. These formats validate the content of a\n" +
      "string, not how it's encoded.",
    reasoning:
      "This is a content note, not an SDK issue. The SDK's job is to\n" +
      "transport the user's string to the server. Whether that string\n" +
      "is actually a valid email or URI is the server's job to check.\n" +
      "The SDK correctly sent a string. The value just doesn't match\n" +
      "the format.",
    example: "  # Spec: email is type: string, format: email\n" +
      '  # SDK sends: {"email": "not-an-email"}   (string, but not email format)\n' +
      "  # The SDK did its job: it sent a string. The value is the user's problem.",
    fix: "This is informational. If you're testing SDK correctness, you\n" +
      "can ignore these. If you want to test with realistic data,\n" +
      "provide valid format values in your test fixtures.",
    seeAlso: ["E3018"],
  },

  E4002: {
    description: "A string value doesn't match the schema's regex pattern\n" +
      "constraint.",
    reasoning:
      "This is a content note. Pattern constraints validate the content\n" +
      "of a value, not how it's transported. The SDK correctly sent a\n" +
      "string. It just doesn't match the pattern the spec requires.",
    example: '  # Spec: code matches pattern "^[A-Z]{3}$"\n' +
      '  # SDK sends: {"code": "abc"}   (lowercase, doesn\'t match)\n' +
      "  # The SDK sent a string. The pattern is a content concern",
    fix: "Informational. If your tests need valid data, use values that\n" +
      "match the pattern.",
    seeAlso: ["E4001", "E4003"],
  },

  E4003: {
    description: "A string value is shorter than minLength or longer than\n" +
      "maxLength.",
    reasoning:
      "This is a content note. String length constraints validate the\n" +
      "content, not the transport. The SDK correctly sent a string.",
    example: "  # Spec: password minLength: 8\n" +
      '  # SDK sends: {"password": "abc"}   (3 chars, need 8)',
    fix: "Informational. If your tests need valid data, use strings\n" +
      "within the length bounds.",
    seeAlso: ["E4002", "E4004"],
  },

  E4004: {
    description:
      "A numeric value is outside the schema's minimum/maximum range,\n" +
      "or violates exclusiveMinimum/exclusiveMaximum.",
    reasoning:
      "This is a content note. Numeric range constraints are about the\n" +
      "value's magnitude, not how it was transported. The SDK correctly\n" +
      "sent a number.",
    example: "  # Spec: age minimum: 0, maximum: 150\n" +
      '  # SDK sends: {"age": -5}   (below minimum)',
    fix: "Informational. If your tests need valid data, use numbers\n" +
      "within the declared range.",
    seeAlso: ["E4003", "E4005"],
  },

  E4005: {
    description: "An array has fewer items than minItems or more items than\n" +
      "maxItems.",
    reasoning: "This is a content note. Array size constraints validate the\n" +
      "content, not the transport. The SDK correctly sent an array.",
    example: "  # Spec: tags minItems: 1, maxItems: 5\n" +
      '  # SDK sends: {"tags": []}   (0 items, need at least 1)',
    fix: "Informational. If your tests need valid data, use arrays\n" +
      "within the size bounds.",
    seeAlso: ["E4004", "E4007"],
  },

  E4007: {
    description:
      "A numeric value is not a multiple of the schema's multipleOf\n" +
      "constraint.",
    reasoning:
      "This is a content note. The multipleOf constraint validates the\n" +
      "value's precision or step, not how it was transported. The SDK\n" +
      "correctly sent a number.",
    example: "  # Spec: quantity multipleOf: 0.01 (cents precision)\n" +
      '  # SDK sends: {"quantity": 1.005}   (not a multiple of 0.01)',
    fix: "Informational. If your tests need valid data, use values that\n" +
      "satisfy the multipleOf constraint.",
    seeAlso: ["E4004"],
  },

  // ── E5xxx: Ambiguous ────────────────────────────────────────────────

  E5001: {
    description:
      "The SDK sent null for a field that isn't marked as nullable in\n" +
      "the spec.",
    reasoning: "This is ambiguous. It could be:\n" +
      "  - SDK bug: the SDK should have omitted the field instead of\n" +
      "    sending null\n" +
      "  - Spec issue: the field should be nullable but isn't declared\n" +
      "    as such\n" +
      "  - Test data: the user passed null and the SDK passed it through\n\n" +
      "Steady can't determine which, so it flags it for human review.",
    example: "  # Spec: name is type: string (not nullable)\n" +
      '  # SDK sends: {"name": null}',
    fix: "If the field can legitimately be null, add nullable: true (3.0)\n" +
      'or type: ["string", "null"] (3.1) to the spec.\n' +
      "If the SDK shouldn't send null, fix the SDK's null handling.\n" +
      "If it's test data, provide a non-null value.",
    seeAlso: ["E5003"],
  },

  E5003: {
    description:
      "The request body contains extra properties, and the schema\n" +
      "doesn't say whether additional properties are allowed or not.\n" +
      "The schema has no additionalProperties declaration; it's\n" +
      "silent on the matter.",
    reasoning: "This is ambiguous. When a schema doesn't declare\n" +
      "additionalProperties, the JSON Schema default is true (allow\n" +
      "them). But many spec authors intend a strict shape without\n" +
      "explicitly saying so. Steady can't know the intent.\n\n" +
      "Contrast with E3009 where the spec explicitly says\n" +
      "additionalProperties: false, where the intent is clear.",
    example:
      '  # Spec: User has properties {name, email}\n  #       (no additionalProperties declaration)\n  # SDK sends: {"name": "Alice", "email": "a@b.com", "nickname": "Al"}\n  #             Is "nickname" OK? Spec doesn\'t say.',
    fix: "If the spec should reject extra properties, add\n" +
      "additionalProperties: false to make the intent explicit (and\n" +
      "this becomes E3009 with clear attribution).\n" +
      "If extra properties are fine, you can ignore this diagnostic.",
    seeAlso: ["E3009"],
  },
};

export { EXPLANATIONS };
