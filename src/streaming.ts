/**
 * Streaming response generator for NDJSON and SSE formats
 *
 * Supports:
 * - application/x-ndjson: Newline-delimited JSON (each line is a complete JSON object)
 * - text/event-stream: Server-Sent Events (data: {...}\n\n format)
 *
 * NDJSON Examples:
 * - Array of objects: each object is streamed as a JSON line
 * - Multiline string: each line is parsed as JSON and streamed
 * - No example: generates from schema with _stream metadata
 *
 * SSE Examples:
 * - Array of SSE events: each item with event/data fields is streamed
 * - No example: generates from schema
 */

import type { SchemaRegistry } from "@steady/json-schema";
import { RegistryResponseGenerator } from "@steady/json-schema";
import type { GenerateOptions } from "@steady/json-schema";
import { warn } from "./logging/mod.ts";

/** Streaming content types that trigger streaming behavior */
export const STREAMING_CONTENT_TYPES = [
  "application/x-ndjson",
  "application/jsonl",
  "application/json-seq",
  "text/event-stream",
] as const;

export type StreamingContentType = typeof STREAMING_CONTENT_TYPES[number];

/**
 * SSE event structure for examples.
 * Supports the standard SSE fields: event, data, id, retry
 */
export interface SSEEvent {
  /** Event type name (default: "message") */
  event?: string;
  /** Event data payload */
  data: unknown;
  /** Event ID for client tracking */
  id?: string | number;
  /** Retry timeout in milliseconds */
  retry?: number;
}

/** Check if a content type is a streaming type */
export function isStreamingContentType(
  contentType: string,
): contentType is StreamingContentType {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return STREAMING_CONTENT_TYPES.includes(normalized as StreamingContentType);
}

/** Get the streaming format for a content type */
export function getStreamFormat(
  contentType: string,
): "ndjson" | "sse" | null {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (
    normalized === "application/x-ndjson" ||
    normalized === "application/jsonl" ||
    normalized === "application/json-seq"
  ) {
    return "ndjson";
  }
  if (normalized === "text/event-stream") {
    return "sse";
  }
  return null;
}

export interface StreamingOptions {
  /** Number of items to stream (default: 5) */
  count?: number;
  /** Interval between items in milliseconds (default: 100) */
  interval?: number;
  /** Generator options for creating items */
  generatorOptions?: GenerateOptions;
  /** Pre-defined example events (for SSE) */
  example?: unknown;
}

const DEFAULT_STREAM_COUNT = 5;
const DEFAULT_STREAM_INTERVAL = 100;

/**
 * Check if an example is an SSE event sequence (array of events with data fields)
 */
export function isSSEEventSequence(example: unknown): example is SSEEvent[] {
  if (!Array.isArray(example) || example.length === 0) {
    return false;
  }
  // Check if items look like SSE events (have data field or event field)
  return example.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      ("data" in item || "event" in item),
  );
}

/**
 * Check if an example is a valid NDJSON example.
 * Valid formats:
 * - Array of objects (that are NOT SSE events)
 * - Multiline string where each line is a valid JSON object
 * - Single-line string that is a valid JSON object
 */
export function isNDJSONExample(example: unknown): boolean {
  // Array of objects (but not SSE event sequences)
  if (Array.isArray(example)) {
    if (example.length === 0) {
      return false;
    }
    // If it looks like SSE events, it's not NDJSON
    if (isSSEEventSequence(example)) {
      return false;
    }
    // Must be array of objects
    return example.every(
      (item) => typeof item === "object" && item !== null,
    );
  }

  // Multiline string of JSON objects
  if (typeof example === "string") {
    const lines = example.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) {
      return false;
    }
    // Try to parse each line as JSON
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Each line must be an object (not array, string, number, etc.)
        if (
          typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Parse an NDJSON example into an array of objects.
 * Handles both array format and multiline string format.
 */
export function parseNDJSONExample(example: unknown): unknown[] {
  // Array format - return as-is
  if (Array.isArray(example)) {
    return example;
  }

  // Multiline string format - parse each line
  if (typeof example === "string") {
    const lines = example.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => JSON.parse(line));
  }

  // Fallback - should not reach here if isNDJSONExample was checked
  return [];
}

/**
 * Creates a streaming response body as a ReadableStream
 */
export function createStreamingResponse(
  registry: SchemaRegistry,
  schema: unknown,
  schemaPointer: string,
  format: "ndjson" | "sse",
  options: StreamingOptions = {},
): ReadableStream<Uint8Array> {
  // For SSE with event sequence examples, use the example-based streaming
  if (
    format === "sse" && options.example && isSSEEventSequence(options.example)
  ) {
    return createSSEFromExample(options.example, options);
  }

  // For NDJSON with examples (array of objects or multiline string), use example-based streaming
  if (format === "ndjson" && options.example) {
    if (isNDJSONExample(options.example)) {
      return createNDJSONFromExample(options.example, options);
    }
    // Example provided but not valid NDJSON format - warn and fall back to schema
    warn(
      `NDJSON example provided but not valid. ` +
        `Expected array of objects or multiline JSON string. Falling back to schema generation.`,
    );
  }

  // Otherwise, generate from schema
  return createStreamFromSchema(
    registry,
    schema,
    schemaPointer,
    format,
    options,
  );
}

/**
 * Create SSE stream from a pre-defined event sequence example
 */
function createSSEFromExample(
  events: SSEEvent[],
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  const interval = options.interval ?? DEFAULT_STREAM_INTERVAL;
  const encoder = new TextEncoder();
  let eventIndex = 0;
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emitEvent = () => {
        if (cancelled || eventIndex >= events.length) {
          // Check if last event was a "done" type - if not, add one
          const lastEvent = events[events.length - 1];
          const lastEventType = lastEvent?.event?.toLowerCase();
          if (
            !cancelled && lastEventType !== "done" &&
            lastEventType !== "complete" && lastEventType !== "end"
          ) {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          }
          controller.close();
          return;
        }

        const event = events[eventIndex]!;
        const formatted = formatSSEEvent(event, eventIndex);
        controller.enqueue(encoder.encode(formatted));

        eventIndex++;

        // Schedule next event
        if (eventIndex < events.length && !cancelled) {
          timeoutId = setTimeout(emitEvent, interval);
        } else if (!cancelled) {
          // Check if we need to add a done event
          const lastEvent = events[events.length - 1];
          const lastEventType = lastEvent?.event?.toLowerCase();
          if (
            lastEventType !== "done" && lastEventType !== "complete" &&
            lastEventType !== "end"
          ) {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          }
          controller.close();
        }
      };

      // Start emitting
      emitEvent();
    },
    cancel() {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  });
}

/**
 * Create NDJSON stream from a pre-defined example (array or multiline string).
 * Unlike schema-generated NDJSON, example-based NDJSON does NOT add _stream metadata.
 */
function createNDJSONFromExample(
  example: unknown,
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  const items = parseNDJSONExample(example);
  const interval = options.interval ?? DEFAULT_STREAM_INTERVAL;
  const encoder = new TextEncoder();
  let itemIndex = 0;
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emitItem = () => {
        if (cancelled || itemIndex >= items.length) {
          controller.close();
          return;
        }

        const item = items[itemIndex]!;
        // Output as JSON line without adding metadata
        const line = JSON.stringify(item) + "\n";
        controller.enqueue(encoder.encode(line));

        itemIndex++;

        // Schedule next item
        if (itemIndex < items.length && !cancelled) {
          timeoutId = setTimeout(emitItem, interval);
        } else if (!cancelled) {
          controller.close();
        }
      };

      // Start emitting
      emitItem();
    },
    cancel() {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  });
}

/**
 * Format an SSE event from an example
 *
 * Supports OpenAI-style events where:
 * - event: null or "" skips the event line (for data-only events like [DONE])
 * - id: null skips the id line
 * - String data is output as-is (not JSON encoded)
 */
function formatSSEEvent(event: SSEEvent, index: number): string {
  const lines: string[] = [];

  // Add ID unless explicitly null (use provided or auto-generate)
  if (event.id !== null) {
    const id = event.id ?? index;
    lines.push(`id: ${id}`);
  }

  // Add retry if specified
  if (event.retry !== undefined) {
    lines.push(`retry: ${event.retry}`);
  }

  // Add event type - skip if null or empty string (for OpenAI-style [DONE])
  if (event.event !== null && event.event !== "") {
    const eventType = event.event ?? "message";
    lines.push(`event: ${eventType}`);
  }

  // Add data - strings output as-is, objects JSON encoded
  const data = typeof event.data === "string"
    ? event.data
    : JSON.stringify(event.data);

  // Handle multi-line data (each line needs "data: " prefix)
  const dataLines = data.split("\n");
  for (const line of dataLines) {
    lines.push(`data: ${line}`);
  }

  // End with double newline
  return lines.join("\n") + "\n\n";
}

/**
 * Create stream from schema (original behavior)
 */
function createStreamFromSchema(
  registry: SchemaRegistry,
  schema: unknown,
  schemaPointer: string,
  format: "ndjson" | "sse",
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  const count = options.count ?? DEFAULT_STREAM_COUNT;
  const interval = options.interval ?? DEFAULT_STREAM_INTERVAL;
  const generatorOptions = options.generatorOptions ?? {};

  // For deterministic streaming, we increment the seed for each item
  const baseSeed = generatorOptions.seed ?? 123456789;

  const encoder = new TextEncoder();
  let itemIndex = 0;
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emitItem = () => {
        if (cancelled || itemIndex >= count) {
          // Send done event for SSE
          if (format === "sse" && !cancelled) {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          }
          controller.close();
          return;
        }

        // Create generator with incremented seed for this item
        const itemSeed = baseSeed + itemIndex;
        const generator = new RegistryResponseGenerator(registry, {
          ...generatorOptions,
          seed: itemSeed,
        });

        let item: unknown;
        if (typeof schema === "object" && schema !== null && "$ref" in schema) {
          const ref = (schema as { $ref: string }).$ref;
          const resolved = registry.resolveRef(ref);
          if (resolved) {
            item = generator.generateFromSchema(resolved.raw, ref, 0);
          } else {
            item = { error: `Unresolved reference: ${ref}` };
          }
        } else {
          item = generator.generateFromSchema(
            schema as Parameters<
              RegistryResponseGenerator["generateFromSchema"]
            >[0],
            schemaPointer,
            0,
          );
        }

        // Format the item based on stream type
        const formatted = formatSchemaStreamItem(
          item,
          format,
          itemIndex,
          count,
        );
        controller.enqueue(encoder.encode(formatted));

        itemIndex++;

        // Schedule next item
        if (itemIndex < count && !cancelled) {
          timeoutId = setTimeout(emitItem, interval);
        } else if (!cancelled) {
          // Send done event for SSE
          if (format === "sse") {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          }
          controller.close();
        }
      };

      // Start emitting
      emitItem();
    },
    cancel() {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  });
}

/**
 * Format a schema-generated item for streaming output
 */
function formatSchemaStreamItem(
  item: unknown,
  format: "ndjson" | "sse",
  index: number,
  total: number,
): string {
  if (format === "sse") {
    // For SSE, wrap in proper event format
    const json = JSON.stringify(item);
    return `id: ${index}\nevent: message\ndata: ${json}\n\n`;
  }

  // NDJSON format: add metadata and output as JSON line
  const itemWithMeta = addStreamingMetadata(item, index, total);
  return JSON.stringify(itemWithMeta) + "\n";
}

/**
 * Add streaming metadata to an item (for NDJSON)
 */
function addStreamingMetadata(
  item: unknown,
  index: number,
  total: number,
): unknown {
  // If item is an object, add metadata fields
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    return {
      ...(item as Record<string, unknown>),
      _stream: {
        index,
        total,
        timestamp: new Date().toISOString(),
      },
    };
  }
  // For non-objects, wrap in an object
  return {
    data: item,
    _stream: {
      index,
      total,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Parse streaming options from request headers
 */
export function parseStreamingOptions(req: Request): StreamingOptions {
  const countHeader = req.headers.get("X-Steady-Stream-Count");
  const intervalHeader = req.headers.get("X-Steady-Stream-Interval-Ms");

  const options: StreamingOptions = {};

  if (countHeader) {
    const count = parseInt(countHeader, 10);
    if (!isNaN(count) && count > 0 && count <= 1000) {
      options.count = count;
    }
  }

  if (intervalHeader) {
    const interval = parseInt(intervalHeader, 10);
    if (!isNaN(interval) && interval >= 0 && interval <= 10000) {
      options.interval = interval;
    }
  }

  return options;
}
