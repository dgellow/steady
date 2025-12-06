#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env --allow-write

/**
 * @module
 */

// Re-export the CLI main entry point
export * from "./cmd/steady.ts";

// Re-export key types and utilities for library usage
export { MockServer } from "./src/server.ts";
export type { ServerConfig } from "./src/types.ts";
export { parseSpecFromFile, SteadyError } from "@steady/openapi";
