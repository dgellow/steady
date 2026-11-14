/**
 * The router's index must not change which template wins.
 *
 * `referenceMatch` is the rule written out as a linear scan: paths without
 * parameters first, then templated paths in order of precedence. The router
 * is compared with it on generated specs and paths, and timed on a spec
 * with 50 000 templated paths.
 */

import { assertEquals } from "@std/assert";
import type {
  OperationObject,
  PathItemObject,
  PathsObject,
} from "@steady/openapi";
import { Router, type RoutingRequest } from "./router.ts";
import { compilePathPattern, matchCompiledPath } from "./path-matcher.ts";

const OP: OperationObject = { responses: { "200": { description: "OK" } } };

/** What a match is reduced to for comparison. */
type Outcome =
  | { kind: "match"; pattern: string; params: Record<string, string> }
  | { kind: "method-not-allowed"; allowed: string[] }
  | { kind: "path-not-found" };

function routerOutcome(router: Router, request: RoutingRequest): Outcome {
  const result = router.match(request);
  if (result.matched) {
    return {
      kind: "match",
      pattern: result.pathPattern,
      params: result.pathParams,
    };
  }
  if (result.reason === "method-not-allowed") {
    return { kind: "method-not-allowed", allowed: result.allowedMethods };
  }
  return { kind: "path-not-found" };
}

const METHODS = ["get", "post", "delete"] as const;

function hasMethod(
  item: PathItemObject,
  method: string,
): method is typeof METHODS[number] {
  return METHODS.some((m) => m === method) &&
    item[METHODS.find((m) => m === method) ?? "get"] !== undefined;
}

/** The precedence rule as a linear scan over every path. */
function referenceMatch(paths: PathsObject, request: RoutingRequest): Outcome {
  const entries = Object.entries(paths);
  const count = (pattern: string, type: string) =>
    compilePathPattern(pattern).segments.filter((s) => s.type === type).length;

  const exact = entries.filter(([p]) => !p.includes("{"));
  const templated = entries.filter(([p]) => p.includes("{"));
  // Stable sort: literals, then mixed segments, then order in the spec.
  templated.sort(([a], [b]) =>
    count(b, "literal") - count(a, "literal") ||
    count(b, "mixed") - count(a, "mixed")
  );

  const allowed = new Set<string>();
  for (const [pattern, item] of exact) {
    if (pattern !== request.path) continue;
    if (hasMethod(item, request.method)) {
      return { kind: "match", pattern, params: {} };
    }
    for (const m of METHODS) if (item[m]) allowed.add(m);
  }
  for (const [pattern, item] of templated) {
    const params = matchCompiledPath(request.path, compilePathPattern(pattern));
    if (!params) continue;
    if (hasMethod(item, request.method)) {
      return { kind: "match", pattern, params };
    }
    for (const m of METHODS) if (item[m]) allowed.add(m);
  }
  if (allowed.size > 0) {
    return {
      kind: "method-not-allowed",
      // Canonical order of the router: get, post, delete.
      allowed: ["get", "post", "delete"].filter((m) => allowed.has(m)),
    };
  }
  return { kind: "path-not-found" };
}

/** Deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("Router: the index picks the same template as a linear scan", () => {
  const random = rng(20261114);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  };

  // A small alphabet makes templates collide: the same shape with different
  // parameter names, literal against parameter, mixed against both.
  const literals = ["a", "b", "v1", "users", "v1.json"];
  const patternSegments = [
    ...literals,
    "{id}",
    "{name}",
    "v{n}",
    "{file}.json",
    "u-{id}-x",
  ];
  const requestSegments = [
    ...literals,
    "v2",
    "x.json",
    "u-7-x",
    "u--x",
    "%41",
    "%zz",
    "v",
  ];

  let compared = 0;
  for (let round = 0; round < 300; round++) {
    const paths: PathsObject = {};
    const pathCount = 1 + Math.floor(random() * 12);
    for (let i = 0; i < pathCount; i++) {
      const length = 1 + Math.floor(random() * 3);
      const pattern = "/" + Array.from(
        { length },
        () => pick(patternSegments),
      ).join("/");
      const item: PathItemObject = {};
      for (const m of METHODS) if (random() < 0.5) item[m] = OP;
      if (!item.get && !item.post && !item.delete) item.get = OP;
      paths[pattern] = item;
    }
    const router = new Router(paths);

    for (let i = 0; i < 60; i++) {
      const length = 1 + Math.floor(random() * 3);
      const path = "/" + Array.from(
        { length },
        () => pick(requestSegments),
      ).join("/") + (random() < 0.1 ? "/" : "");
      const request = { path, method: pick(METHODS) };
      assertEquals(
        routerOutcome(router, request),
        referenceMatch(paths, request),
        `${request.method} ${path} against ${
          JSON.stringify(Object.keys(paths))
        }`,
      );
      compared++;
    }
  }
  assertEquals(compared, 18000);
});

Deno.test("Router: matching does not slow down with the number of paths", () => {
  const paths: PathsObject = {};
  const total = 50_000;
  for (let i = 0; i < total; i++) {
    paths[`/r${i}/{id}/sub`] = { get: OP };
  }
  const router = new Router(paths);

  const requests = 2000;
  const start = performance.now();
  for (let i = 0; i < requests; i++) {
    const n = total - 1 - (i % 100);
    const result = router.match({ path: `/r${n}/abc/sub`, method: "get" });
    if (!result.matched || result.pathPattern !== `/r${n}/{id}/sub`) {
      throw new Error(`wrong match for /r${n}/abc/sub`);
    }
  }
  const elapsed = performance.now() - start;

  // A linear scan took 38 000 ms here (19 ms per request). The bound leaves
  // two orders of magnitude for slow machines.
  assertEquals(
    elapsed < 400,
    true,
    `2000 requests took ${elapsed.toFixed(0)} ms`,
  );
});
