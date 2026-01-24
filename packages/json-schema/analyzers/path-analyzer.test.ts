/**
 * Tests for PathAnalyzer
 */

import { assertEquals } from "@std/assert";
import { PathAnalyzer } from "./path-analyzer.ts";
import { SchemaRegistry } from "../schema-registry.ts";

Deno.test("PathAnalyzer: detects duplicate path patterns", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/v1/admin/secrets/{secret_id}": {
        delete: {
          responses: { "204": { description: "Deleted" } },
        },
      },
      "/v1/admin/secrets/{secret_key}": {
        post: {
          responses: { "200": { description: "Created" } },
        },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
  assertEquals(diagnostics[0]!.severity, "warning");
  assertEquals(
    diagnostics[0]!.message.includes("has the same pattern as"),
    true,
  );
  assertEquals(diagnostics[0]!.related?.length, 1);
});

Deno.test("PathAnalyzer: no warning for distinct patterns", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users/{user_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/posts/{post_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});

Deno.test("PathAnalyzer: no warning for exact paths (no parameters)", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/posts": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});

Deno.test("PathAnalyzer: detects multiple duplicates in same group", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/items/{item_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/items/{item_key}": {
        post: { responses: { "200": { description: "OK" } } },
      },
      "/items/{item_name}": {
        delete: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.related?.length, 2);
});

Deno.test("PathAnalyzer: handles nested parameters", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/orgs/{org_id}/repos/{repo_id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/orgs/{organization}/repos/{repository}": {
        post: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const registry = new SchemaRegistry(spec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0]!.code, "path-duplicate-pattern");
});

Deno.test("PathAnalyzer: skips non-OpenAPI specs", () => {
  const notASpec = {
    something: "else",
  };

  const registry = new SchemaRegistry(notASpec);
  const analyzer = new PathAnalyzer();
  const diagnostics = analyzer.analyze(registry);

  assertEquals(diagnostics.length, 0);
});
