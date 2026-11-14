/**
 * Shape of an OpenAPI document as it comes out of a parser.
 *
 * `OpenAPIRaw` declares what every node is: a path item is an object, an
 * operation's parameters are an array, a media type's schema is a schema. A
 * parsed document promises none of that. `paths: {"/users": null}` and
 * `parameters: 5` are valid YAML.
 *
 * `normalizeSpecShape` is the boundary between the two. It visits every
 * node the server reads and checks its type. A node of the wrong type is
 * reported with its location and removed, which makes it absent: the one
 * state every reader already handles. After it has run, the document has
 * the shape its type declares, and no reader has to check again.
 *
 * Schemas are checked by `normalizeSchemaShape` from @steady/json-schema,
 * which owns the types of schema keywords.
 */

import {
  formatFragmentPointer,
  isFragmentPointer,
  isPlainObject,
  parseFragmentPointer,
  type PointerPath,
} from "@steady/json-pointer";
import {
  describeJsonType,
  normalizeSchemaShape,
  type ShapeProblem,
} from "@steady/json-schema";

export type { ShapeProblem };

const METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
  "query",
];

const PARAMETER_LOCATIONS = ["path", "query", "header", "cookie"];

type Node = Record<string, unknown>;

export function normalizeSpecShape(spec: Node): ShapeProblem[] {
  const problems: ShapeProblem[] = [];
  const report = (problem: ShapeProblem) => {
    problems.push(problem);
  };

  /** Report and remove `holder[key]` unless `ok`. Returns whether it stays. */
  const keep = (
    holder: Node,
    key: string,
    path: PointerPath,
    ok: boolean,
    expected: string,
  ): boolean => {
    if (ok) return true;
    report({ path, expected, actual: describeJsonType(holder[key]) });
    delete holder[key];
    return false;
  };

  /** `holder[key]` as an object, or undefined after reporting and removing it. */
  const objectAt = (
    holder: Node,
    key: string,
    path: PointerPath,
  ): Node | undefined => {
    if (!Object.hasOwn(holder, key)) return undefined;
    const value = holder[key];
    if (isPlainObject(value)) return value;
    keep(holder, key, path, false, "an object");
    return undefined;
  };

  /** Apply `visit` to every entry of the object at `holder[key]`. */
  const eachEntry = (
    holder: Node,
    key: string,
    path: PointerPath,
    visit: (map: Node, name: string, entryPath: PointerPath) => void,
  ): void => {
    const map = objectAt(holder, key, path);
    if (map === undefined) return;
    for (const name of Object.keys(map)) visit(map, name, [...path, name]);
  };

  /** A reference object: `{ $ref: string }`. Nothing else in it is read. */
  const isReference = (value: Node): boolean => typeof value.$ref === "string";

  /**
   * `holder[key]` as an object that is not a reference. A `$ref` that is not
   * a string makes the whole node unreadable.
   */
  const ownObjectAt = (
    holder: Node,
    key: string,
    path: PointerPath,
  ): Node | undefined => {
    const value = objectAt(holder, key, path);
    if (value === undefined) return undefined;
    if (!Object.hasOwn(value, "$ref")) return value;
    if (isReference(value)) return undefined;
    // Reported at the node, which is what is removed: references to it are
    // then recognised as references to a removed value.
    report({
      path,
      expected: "a reference whose $ref is a string",
      actual: `object with a $ref of type ${describeJsonType(value.$ref)}`,
    });
    delete holder[key];
    return undefined;
  };

  /**
   * The schema of a parameter, header, media type or component.
   *
   * JSON Schema 2020-12 allows `true` and `false` as schemas. The OpenAPI
   * types declare these positions as objects, and their readers look for
   * `$ref` in them. A boolean is rewritten to the object that means the
   * same: `true` is `{}`, `false` is `{not: {}}`. Schemas nested inside
   * another schema keep their booleans; the validator handles those.
   */
  const schemaAt = (holder: Node, key: string, path: PointerPath): void => {
    if (!Object.hasOwn(holder, key)) return;
    if (!normalizeSchemaShape(holder, key, path, report)) return;
    if (holder[key] === true) holder[key] = {};
    else if (holder[key] === false) holder[key] = { not: {} };
  };

  const mediaType = (map: Node, name: string, path: PointerPath): void => {
    const media = objectAt(map, name, path);
    if (media === undefined) return;
    schemaAt(media, "schema", [...path, "schema"]);
    eachEntry(media, "examples", [...path, "examples"], (m, n, p) => {
      objectAt(m, n, p);
    });
    eachEntry(media, "encoding", [...path, "encoding"], (m, n, p) => {
      const encoding = objectAt(m, n, p);
      if (encoding === undefined) return;
      keepIfPresent(encoding, "contentType", p, "string");
      eachEntry(encoding, "headers", [...p, "headers"], header);
    });
  };

  /** Report and remove an optional scalar field of the wrong type. */
  const keepIfPresent = (
    holder: Node,
    key: string,
    path: PointerPath,
    type: "string" | "boolean",
  ): void => {
    if (!Object.hasOwn(holder, key)) return;
    keep(
      holder,
      key,
      [...path, key],
      type === "string"
        ? typeof holder[key] === "string"
        : typeof holder[key] === "boolean",
      type === "string" ? "a string" : "a boolean",
    );
  };

  /** Fields shared by Parameter Objects and Header Objects. */
  const parameterFields = (node: Node, path: PointerPath): void => {
    keepIfPresent(node, "required", path, "boolean");
    keepIfPresent(node, "explode", path, "boolean");
    keepIfPresent(node, "allowReserved", path, "boolean");
    keepIfPresent(node, "allowEmptyValue", path, "boolean");
    keepIfPresent(node, "style", path, "string");
    schemaAt(node, "schema", [...path, "schema"]);
    eachEntry(node, "content", [...path, "content"], mediaType);
    eachEntry(node, "examples", [...path, "examples"], (m, n, p) => {
      objectAt(m, n, p);
    });
  };

  function header(map: Node, name: string, path: PointerPath): void {
    const node = ownObjectAt(map, name, path);
    if (node !== undefined) parameterFields(node, path);
  }

  /** Whether a parameter that is not a reference can be used at all. */
  const parameterProblem = (node: Node): string | undefined => {
    if (typeof node.name !== "string") return "a parameter with a string name";
    if (
      typeof node.in !== "string" || !PARAMETER_LOCATIONS.includes(node.in)
    ) {
      return 'a parameter with "in" set to path, query, header or cookie';
    }
    return undefined;
  };

  /** A Parameter Object stored under a name (components.parameters). */
  const namedParameter = (map: Node, name: string, path: PointerPath): void => {
    const node = ownObjectAt(map, name, path);
    if (node === undefined) return;
    const problem = parameterProblem(node);
    if (problem !== undefined) {
      keep(map, name, path, false, problem);
      return;
    }
    parameterFields(node, path);
  };

  /** The `parameters` array of a path item or an operation. */
  const parameters = (holder: Node, path: PointerPath): void => {
    if (!Object.hasOwn(holder, "parameters")) return;
    const list = holder.parameters;
    if (!Array.isArray(list)) {
      keep(holder, "parameters", path, false, "an array of parameters");
      return;
    }
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const entry: unknown = list[read];
      // The index before any removal, which is the index in the document.
      const entryPath = [...path, String(read)];
      const fail = (expected: string, at: PointerPath, value: unknown) => {
        report({ path: at, expected, actual: describeJsonType(value) });
      };
      if (!isPlainObject(entry)) {
        fail("a parameter object", entryPath, entry);
        continue;
      }
      if (Object.hasOwn(entry, "$ref")) {
        if (!isReference(entry)) {
          report({
            path: entryPath,
            expected: "a reference whose $ref is a string",
            actual: `object with a $ref of type ${
              describeJsonType(entry.$ref)
            }`,
          });
          continue;
        }
      } else {
        const problem = parameterProblem(entry);
        if (problem !== undefined) {
          fail(problem, entryPath, entry);
          continue;
        }
        parameterFields(entry, entryPath);
      }
      list[write++] = entry;
    }
    list.length = write;
  };

  const requestBody = (holder: Node, key: string, path: PointerPath): void => {
    const body = ownObjectAt(holder, key, path);
    if (body === undefined) return;
    keepIfPresent(body, "required", path, "boolean");
    eachEntry(body, "content", [...path, "content"], mediaType);
    // `content` is required. A body without readable content has none.
    if (!isPlainObject(body.content)) body.content = {};
  };

  const response = (map: Node, name: string, path: PointerPath): void => {
    const node = ownObjectAt(map, name, path);
    if (node === undefined) return;
    eachEntry(node, "content", [...path, "content"], mediaType);
    eachEntry(node, "headers", [...path, "headers"], header);
  };

  const operation = (holder: Node, key: string, path: PointerPath): void => {
    const node = objectAt(holder, key, path);
    if (node === undefined) return;
    parameters(node, [...path, "parameters"]);
    requestBody(node, "requestBody", [...path, "requestBody"]);
    const before = problems.length;
    eachEntry(node, "responses", [...path, "responses"], response);
    // Responses that lost every entry say no more than no responses, and an
    // empty object is itself invalid in OpenAPI 3.1. Removing a value must
    // not create a new violation.
    if (
      problems.length > before && isPlainObject(node.responses) &&
      Object.keys(node.responses).length === 0
    ) {
      delete node.responses;
    }
  };

  const pathItem = (map: Node, name: string, path: PointerPath): void => {
    const item = objectAt(map, name, path);
    if (item === undefined) return;
    keepIfPresent(item, "$ref", path, "string");
    parameters(item, [...path, "parameters"]);
    for (const method of METHODS) {
      if (Object.hasOwn(item, method)) {
        operation(item, method, [...path, method]);
      }
    }
  };

  const structure = (): void => {
    // paths and webhooks
    eachEntry(spec, "paths", ["paths"], pathItem);
    eachEntry(spec, "webhooks", ["webhooks"], pathItem);

    // components
    const components = objectAt(spec, "components", ["components"]);
    if (components !== undefined) {
      const section = (
        name: string,
        visit: (map: Node, entry: string, path: PointerPath) => void,
      ) => eachEntry(components, name, ["components", name], visit);

      section("schemas", schemaAt);
      section("responses", response);
      section("parameters", namedParameter);
      section("requestBodies", requestBody);
      section("headers", header);
      section("pathItems", pathItem);
      section("examples", (map, name, path) => {
        objectAt(map, name, path);
      });
    }

    // servers
    if (Object.hasOwn(spec, "servers")) {
      const servers = spec.servers;
      if (!Array.isArray(servers)) {
        keep(spec, "servers", ["servers"], false, "an array of servers");
      } else {
        let write = 0;
        for (let read = 0; read < servers.length; read++) {
          const entry: unknown = servers[read];
          if (isPlainObject(entry) && typeof entry.url === "string") {
            servers[write++] = entry;
          } else {
            report({
              path: ["servers", String(read)],
              expected: "a server object with a string url",
              actual: describeJsonType(entry),
            });
          }
        }
        servers.length = write;
      }
    }
  };

  // Removing a value leaves references to it dangling, and removing those
  // can leave a node without what makes it readable (a parameter that was
  // only a reference). Repeat until nothing more is removed. A well-formed
  // spec takes one pass and never looks for references.
  let known = -1;
  while (problems.length !== known) {
    known = problems.length;
    structure();
    if (problems.length > 0) dropReferencesInto(spec, problems);
  }

  return problems;
}

/**
 * Remove references whose target was removed.
 *
 * A removed value leaves the references into it dangling. A dangling
 * reference is fatal (E1004), which would turn one unreadable value into a
 * spec that does not load. The reference can no more be read than its
 * target, so it is reported and removed the same way. What remains is the
 * object without `$ref`, which states nothing.
 *
 * Only runs when something was removed, so a well-formed spec pays nothing.
 */
function dropReferencesInto(spec: Node, problems: ShapeProblem[]): void {
  // A dropped reference is reported at its `$ref` key. That key is gone,
  // but nothing can refer into a string, so it is harmless in this list.
  const removed = problems.map((p) => p.path);
  const targetOf = (ref: string): PointerPath | undefined => {
    if (!isFragmentPointer(ref)) return undefined;
    try {
      return parseFragmentPointer(ref);
    } catch {
      // Not a valid pointer. The analyzer reports it.
      return undefined;
    }
  };
  const removedAncestor = (target: PointerPath): PointerPath | undefined =>
    removed.find((path) =>
      path.length <= target.length &&
      path.every((segment, i) => segment === target[i])
    );

  const pending: { node: unknown; path: PointerPath }[] = [{
    node: spec,
    path: [],
  }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, path } = item;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child: unknown = node[i];
        if (typeof child === "object" && child !== null) {
          pending.push({ node: child, path: [...path, String(i)] });
        }
      }
      continue;
    }
    if (!isPlainObject(node)) continue;

    if (typeof node.$ref === "string") {
      const target = targetOf(node.$ref);
      const ancestor = target && removedAncestor(target);
      if (ancestor !== undefined) {
        problems.push({
          path: [...path, "$ref"],
          expected: "a reference to a value Steady can read",
          actual: "string",
          message: `Reference to ${node.$ref}, which is inside ${
            formatFragmentPointer(ancestor)
          }, a value Steady ignores. Steady ignores this reference too`,
        });
        delete node.$ref;
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (typeof child === "object" && child !== null) {
        pending.push({ node: child, path: [...path, key] });
      }
    }
  }
}
