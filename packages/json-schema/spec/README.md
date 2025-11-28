# JSON Schema 2020-12 Specification Files

This directory contains the official JSON Schema 2020-12 meta-schemas downloaded
from json-schema.org.

## Files

- `schema` - Main meta-schema that combines all vocabularies
- `core` - Core vocabulary (refs, anchors, etc.)
- `applicator` - Applicator keywords (properties, items, etc.)
- `validation` - Validation keywords (type, minimum, etc.)
- `unevaluated` - Unevaluated properties/items
- `format-annotation` - Format annotation
- `content` - Content keywords (contentMediaType, etc.)
- `meta-data` - Metadata keywords (title, description, etc.)

## Format Validators Required by JSON Schema

The JSON Schema specification defines these formats that validators SHOULD
support:

### Date and Time (RFC 3339)

- `date-time` - Date and time together
- `date` - Full date
- `time` - Time with optional timezone
- `duration` - Duration (ISO 8601)

### Internet (RFC)

- `email` - Internet email address (RFC 5321)
- `idn-email` - Internationalized email (RFC 6531)
- `hostname` - Internet hostname (RFC 1123)
- `idn-hostname` - Internationalized hostname (RFC 5890)
- `ipv4` - IPv4 address (RFC 2673)
- `ipv6` - IPv6 address (RFC 4291)
- `uri` - Universal Resource Identifier (RFC 3986)
- `uri-reference` - URI reference (RFC 3986)
- `iri` - Internationalized Resource Identifier (RFC 3987)
- `iri-reference` - IRI reference (RFC 3987)
- `uuid` - UUID (RFC 4122)

### JSON Schema Specific

- `regex` - ECMA-262 regular expression
- `json-pointer` - JSON Pointer (RFC 6901)
- `relative-json-pointer` - Relative JSON Pointer

### Other

- `uri-template` - URI Template (RFC 6570)

## Content Keywords (from content vocabulary)

- `contentMediaType` - MIME type of string content
- `contentEncoding` - Encoding of string content (e.g., base64)
- `contentSchema` - Schema for decoded content
