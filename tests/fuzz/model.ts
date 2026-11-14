/**
 * A typed model of a JSON Schema, and what follows from it.
 *
 * The fuzzer does not judge Steady against schemas written by others. It
 * builds the schema itself, from a model, and derives three things from the
 * same model:
 *
 * - `toSchema`: the JSON Schema that goes into the spec
 * - `validValue`: values that are valid by construction
 * - `faults`: copies of a valid value with exactly one thing wrong, each
 *   with the finding that fault must cause
 *
 * Because all three come from one model, a disagreement between Steady and
 * the expectation is a defect in Steady or in this file. It is never a
 * defect in a spec.
 *
 * The model covers what Steady validates. `pattern`, `patternProperties`
 * and conditional schemas are not evaluated by design and are not modelled.
 */

import fc from "fast-check";

/** What a value has to be. */
type Shape =
  | { kind: "boolean" }
  | {
    kind: "integer";
    minimum?: number;
    maximum?: number;
    /** Only without bounds. */
    multipleOf?: number;
  }
  | { kind: "number"; minimum?: number; maximum?: number }
  | { kind: "string"; minLength?: number; maxLength?: number }
  | { kind: "enum"; values: string[] }
  | { kind: "const"; value: string | number | boolean }
  | {
    kind: "array";
    items: Model;
    minItems?: number;
    maxItems?: number;
    /** Only for items that are unbounded integers. */
    uniqueItems?: boolean;
  }
  | {
    kind: "object";
    properties: { name: string; model: Model; required: boolean }[];
    /** `additionalProperties: false` */
    closed: boolean;
  }
  /** An object with any keys, `additionalProperties: <values>`. */
  | { kind: "map"; values: Model }
  /**
   * One of several schemas. The variants accept different JSON types, so
   * a value belongs to at most one of them, whatever the keyword.
   */
  | { kind: "union"; keyword: "oneOf" | "anyOf"; variants: Model[] };

/**
 * How the schema is written. The same shape can be written in several
 * ways, and none of them may change a finding.
 */
interface Presentation {
  /**
   * Whether null is also accepted, and how the schema says so:
   * `type: [T, "null"]`, `anyOf: [T, {type: "null"}]`, or the same with
   * `oneOf`.
   */
  nullable?: "type" | "anyOf" | "oneOf";
  /**
   * `ref`: the schema is a component and the place of use is a `$ref`.
   * `allOf`: the schema is the only member of an `allOf`.
   */
  via?: "ref" | "allOf";
}

export type Model = Shape & Presentation;

// ── Model to schema ─────────────────────────────────────────────────

/** A schema, and the components it refers to. */
export interface SchemaParts {
  schema: Record<string, unknown>;
  /** `components.schemas` of the spec. */
  components: Record<string, Record<string, unknown>>;
}

export function toSchema(model: Model): SchemaParts {
  const components: Record<string, Record<string, unknown>> = {};
  return { schema: build(model, components), components };
}

function build(
  model: Model,
  components: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  let schema = shapeSchema(model, components);
  if (model.nullable === "type") {
    schema = { ...schema, type: [schema.type, "null"] };
  } else if (model.nullable !== undefined) {
    schema = { [model.nullable]: [schema, { type: "null" }] };
  }
  if (model.via === "ref") {
    // The schemas nested in this one are already in `components`.
    const name = `S${Object.keys(components).length}`;
    components[name] = schema;
    return { $ref: `#/components/schemas/${name}` };
  }
  if (model.via === "allOf") return { allOf: [schema] };
  return schema;
}

function shapeSchema(
  model: Model,
  components: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  switch (model.kind) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return {
        type: "integer",
        ...(model.minimum !== undefined ? { minimum: model.minimum } : {}),
        ...(model.maximum !== undefined ? { maximum: model.maximum } : {}),
        ...(model.multipleOf !== undefined
          ? { multipleOf: model.multipleOf }
          : {}),
      };
    case "number":
      return {
        type: "number",
        ...(model.minimum !== undefined ? { minimum: model.minimum } : {}),
        ...(model.maximum !== undefined ? { maximum: model.maximum } : {}),
      };
    case "string":
      return {
        type: "string",
        ...(model.minLength !== undefined
          ? { minLength: model.minLength }
          : {}),
        ...(model.maxLength !== undefined
          ? { maxLength: model.maxLength }
          : {}),
      };
    case "enum":
      // No `type` next to `enum`: a value of another type then violates one
      // keyword, not two, and a fault keeps causing exactly one finding.
      return { enum: model.values };
    case "const":
      return { const: model.value };
    case "array":
      return {
        type: "array",
        items: build(model.items, components),
        ...(model.minItems !== undefined ? { minItems: model.minItems } : {}),
        ...(model.maxItems !== undefined ? { maxItems: model.maxItems } : {}),
        ...(model.uniqueItems === true ? { uniqueItems: true } : {}),
      };
    case "object": {
      const required = model.properties.filter((p) => p.required).map((p) =>
        p.name
      );
      return {
        type: "object",
        properties: Object.fromEntries(
          model.properties.map((p) => [p.name, build(p.model, components)]),
        ),
        ...(required.length > 0 ? { required } : {}),
        ...(model.closed ? { additionalProperties: false } : {}),
      };
    }
    case "map":
      return {
        type: "object",
        additionalProperties: build(model.values, components),
      };
    case "union":
      return {
        [model.keyword]: model.variants.map((v) => build(v, components)),
      };
  }
}

/** The JSON type a value has, or a shape accepts. */
type JsonType = "boolean" | "number" | "string" | "array" | "object";

/** `undefined` for shapes that do not accept exactly one JSON type. */
function jsonTypeOf(model: Model): JsonType | undefined {
  switch (model.kind) {
    case "boolean":
    case "string":
    case "array":
      return model.kind;
    case "integer":
    case "number":
      return "number";
    case "object":
    case "map":
      return "object";
    case "enum":
    case "const":
    case "union":
      return undefined;
  }
}

function jsonTypeOfValue(value: unknown): JsonType | undefined {
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "object" && value !== null) return "object";
  return undefined;
}

// ── Model to valid values ───────────────────────────────────────────

/** Characters for generated strings: ASCII, non-ASCII, and outside the BMP. */
const CHARACTERS = ["a", "Z", "0", " ", "é", "名", "😀", "-", "_", "."];

/** A string of exactly `length` characters (code points). */
const stringOfLength = (length: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...CHARACTERS), {
    minLength: length,
    maxLength: length,
  }).map((chars) => chars.join(""));

export function validValue(model: Model): fc.Arbitrary<unknown> {
  const value = shapeValue(model);
  return model.nullable === undefined
    ? value
    : fc.oneof({ weight: 4, arbitrary: value }, {
      weight: 1,
      arbitrary: fc.constant(null),
    });
}

function shapeValue(model: Model): fc.Arbitrary<unknown> {
  switch (model.kind) {
    case "boolean":
      return fc.boolean();
    case "integer":
      if (model.multipleOf !== undefined) {
        const step = model.multipleOf;
        return fc.integer({ min: -100, max: 100 }).map((n) => n * step);
      }
      return fc.integer({
        min: model.minimum ?? -1000,
        max: model.maximum ?? 1000,
      });
    case "number":
      return fc.oneof(
        fc.integer({
          min: Math.ceil(model.minimum ?? -1000),
          max: Math.floor(model.maximum ?? 1000),
        }),
        fc.double({
          min: model.minimum ?? -1000,
          max: model.maximum ?? 1000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
      );
    case "string":
      return fc.integer({
        min: model.minLength ?? 0,
        max: model.maxLength ?? (model.minLength ?? 0) + 6,
      }).chain(stringOfLength);
    case "enum":
      return fc.constantFrom(...model.values);
    case "const":
      return fc.constant(model.value);
    case "array": {
      const size = {
        minLength: model.minItems ?? 0,
        maxLength: model.maxItems ?? (model.minItems ?? 0) + 3,
      };
      return model.uniqueItems === true
        ? fc.uniqueArray(validValue(model.items), size)
        : fc.array(validValue(model.items), size);
    }
    case "object": {
      // Required properties are always present, optional ones sometimes.
      const entry = (name: string, v: unknown): [string, unknown][] => [[
        name,
        v,
      ]];
      const entries = model.properties.map((p) =>
        p.required
          ? validValue(p.model).map((v) => entry(p.name, v))
          : fc.option(validValue(p.model).map((v) => entry(p.name, v)), {
            nil: [],
          })
      );
      return fc.tuple(...entries).map((parts) =>
        Object.fromEntries(parts.flat())
      );
    }
    case "union":
      return fc.oneof(...model.variants.map(validValue));
    case "map":
      return fc.uniqueArray(fc.constantFrom(...PROPERTY_NAMES), {
        maxLength: 3,
      }).chain((keys) =>
        fc.tuple(...keys.map(() => validValue(model.values))).map((values) =>
          Object.fromEntries(keys.map((key, index) => [key, values[index]]))
        )
      );
  }
}

// ── Model to faults ─────────────────────────────────────────────────

/** A finding Steady must report for a fault. */
export interface Expected {
  code: string;
  /** Location in the body, as path segments below the root. */
  path: string[];
  /** Whether the request must be rejected with 400. */
  rejects: boolean;
}

export interface Fault {
  /** What was done to the valid value. */
  label: string;
  /** The whole body with the fault in it. */
  body: unknown;
  expected: Expected;
}

/**
 * A value of a JSON type the model does not accept. `enum` and `const` have
 * no type of their own; their faults are a value outside the enum and a
 * value that is not the constant.
 */
function valueOfOtherType(model: Model): unknown {
  switch (model.kind) {
    case "string":
      return 42;
    case "boolean":
    case "integer":
    case "number":
    case "array":
    case "object":
    case "map":
      return "a string";
    case "enum":
    case "const":
    case "union":
      return undefined;
  }
}

/** Replace the value at `path` inside a copy of `root`. */
function withValueAt(root: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (Array.isArray(root)) {
    const copy = [...root];
    const index = Number(head);
    copy[index] = withValueAt(copy[index], rest, value);
    return copy;
  }
  if (typeof root === "object" && root !== null) {
    const copy: Record<string, unknown> = { ...root };
    copy[head] = withValueAt(copy[head], rest, value);
    return copy;
  }
  throw new Error(`no container at ${path.join("/")}`);
}

function childOf(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value[Number(key)];
  if (typeof value === "object" && value !== null) {
    const record: Record<string, unknown> = { ...value };
    return record[key];
  }
  return undefined;
}

/**
 * Every single fault that can be injected into `value`, a valid value of
 * `model`. Each fault changes one place and must cause exactly one finding.
 */
export function faults(model: Model, value: unknown): Fault[] {
  const out: Fault[] = [];

  /**
   * `isArrayItem`: the value is a direct item of an array.
   * `inOptionalProperty`: the value is the value of an optional property.
   * `isVariant`: the schema is one variant of a union. A value of another
   * type may then be a valid value of another variant, so faults that
   * change the JSON type are left out.
   */
  const visit = (
    node: Model,
    current: unknown,
    path: string[],
    isArrayItem: boolean,
    inOptionalProperty: boolean,
    isVariant = false,
  ): void => {
    const at = path.length === 0 ? "the body" : path.join(".");
    const add = (label: string, replacement: unknown, expected: Expected) => {
      out.push({
        label: `${label} at ${at}`,
        body: withValueAt(value, path, replacement),
        expected,
      });
    };

    // A value of another JSON type. An item of an array has its own code.
    const typeCode = isArrayItem ? "E3010" : "E3008";
    const other = isVariant ? undefined : valueOfOtherType(node);
    if (other !== undefined) {
      add("value of another type", other, {
        code: typeCode,
        path,
        rejects: true,
      });
    }

    // Null where the schema does not accept it. Steady cannot tell an SDK
    // that sends null for "absent" from a spec that forgot to allow null:
    // ambiguous, served. `enum` and `const` have no type; null is then a
    // value outside the enum, or not the constant.
    if (node.nullable === undefined && other !== undefined) {
      add("null where null is not accepted", null, {
        code: "E5001",
        path,
        rejects: false,
      });
    }

    const numberBounds = (
      minimum: number | undefined,
      maximum: number | undefined,
    ) => {
      if (minimum !== undefined) {
        add("number below minimum", minimum - 1, {
          code: "E4004",
          path,
          rejects: false,
        });
      }
      if (maximum !== undefined) {
        add("number above maximum", maximum + 1, {
          code: "E4004",
          path,
          rejects: false,
        });
      }
    };

    switch (node.kind) {
      case "boolean":
        break;
      case "integer": {
        if (typeof current === "number") {
          // A fraction that stays inside the bounds, so that the type is
          // the only thing wrong with it.
          const up = current + 0.5;
          const down = current - 0.5;
          const fraction = node.maximum === undefined || up <= node.maximum
            ? up
            : node.minimum === undefined || down >= node.minimum
            ? down
            : undefined;
          if (
            fraction !== undefined && node.multipleOf === undefined &&
            !isVariant
          ) {
            add("a fraction where an integer is required", fraction, {
              code: typeCode,
              path,
              rejects: true,
            });
          }
        }
        numberBounds(node.minimum, node.maximum);
        if (
          node.multipleOf !== undefined && node.multipleOf > 1 &&
          typeof current === "number"
        ) {
          add("integer that is not a multiple", current + 1, {
            code: "E4007",
            path,
            rejects: false,
          });
        }
        break;
      }
      case "number":
        numberBounds(node.minimum, node.maximum);
        break;
      case "string":
        if (node.minLength !== undefined && node.minLength > 0) {
          add("string shorter than minLength", "a".repeat(node.minLength - 1), {
            code: "E4003",
            path,
            rejects: false,
          });
        }
        if (node.maxLength !== undefined) {
          add("string longer than maxLength", "a".repeat(node.maxLength + 1), {
            code: "E4003",
            path,
            rejects: false,
          });
        }
        break;
      case "enum":
        add("string outside the enum", node.values.join("") + "!", {
          code: "E3016",
          path,
          rejects: true,
        });
        break;
      case "const":
        add(
          "value that is not the constant",
          typeof node.value === "string"
            ? node.value + "!"
            : "not the constant",
          { code: "E3017", path, rejects: true },
        );
        break;
      case "array": {
        if (!Array.isArray(current)) break;
        if (node.minItems !== undefined && node.minItems > 0) {
          add(
            "array shorter than minItems",
            current.slice(0, node.minItems - 1),
            {
              code: "E4005",
              path,
              rejects: false,
            },
          );
        }
        if (node.maxItems !== undefined && current.length > 0) {
          const longer = [...current];
          // Unique items are unbounded integers: count up from the largest
          // so that the length is the only thing wrong.
          let next = Math.max(
            ...current.map((item) => typeof item === "number" ? item : 0),
          );
          while (longer.length <= node.maxItems) {
            longer.push(node.uniqueItems === true ? ++next : current[0]);
          }
          add("array longer than maxItems", longer, {
            code: "E4005",
            path,
            rejects: false,
          });
        }
        if (node.uniqueItems === true && current.length >= 2) {
          const repeated = [...current];
          repeated[1] = repeated[0];
          add("array with a repeated item", repeated, {
            code: "E4002",
            path,
            rejects: false,
          });
        }
        current.forEach((item, index) =>
          visit(node.items, item, [...path, String(index)], true, false)
        );
        break;
      }
      case "union": {
        // The variant this value belongs to is the one that accepts its
        // JSON type. A fault inside it must be reported exactly as if the
        // schema were that variant alone.
        const type = jsonTypeOfValue(current);
        const variant = node.variants.find((v) => jsonTypeOf(v) === type);
        if (variant !== undefined) {
          visit(variant, current, path, isArrayItem, inOptionalProperty, true);
        }
        break;
      }
      case "map": {
        if (
          typeof current !== "object" || current === null ||
          Array.isArray(current)
        ) break;
        // No key of a map is required.
        for (const [key, item] of Object.entries(current)) {
          visit(node.values, item, [...path, key], false, true);
        }
        break;
      }
      case "object": {
        if (
          typeof current !== "object" || current === null ||
          Array.isArray(current)
        ) break;
        const record: Record<string, unknown> = { ...current };
        for (const property of node.properties) {
          if (!Object.hasOwn(record, property.name)) continue;
          if (property.required) {
            const without = { ...record };
            delete without[property.name];
            // Reported at the object that lacks the property. When that
            // object is itself the value of an optional property, Steady
            // cannot tell whether the SDK meant to omit the parent, and
            // reports the ambiguous E3013 without rejecting.
            add(
              `required property "${property.name}" removed`,
              without,
              inOptionalProperty
                ? { code: "E3013", path, rejects: false }
                : { code: "E3007", path, rejects: true },
            );
          }
          visit(
            property.model,
            childOf(record, property.name),
            [...path, property.name],
            false,
            !property.required,
          );
        }
        if (node.closed) {
          add("property the schema forbids", { ...record, "not-declared": 1 }, {
            code: "E3009",
            path,
            rejects: true,
          });
        }
        break;
      }
    }
  };

  visit(model, value, [], false, false);
  return out;
}

// ── Generating models ───────────────────────────────────────────────

/**
 * Property names. Besides plain ones: a name that is also a member of
 * `Object.prototype`, one that is also a schema keyword, and ones with
 * characters that need care in pointers and headers.
 */
const PROPERTY_NAMES = [
  "id",
  "name",
  "kind",
  "items",
  "toString",
  "required",
  "with space",
  "x-y",
  "ünï",
];

const bounds = (
  low: fc.Arbitrary<number>,
  span: fc.Arbitrary<number>,
): fc.Arbitrary<{ min?: number; max?: number }> =>
  fc.record({
    min: fc.option(low, { nil: undefined }),
    span: fc.option(span, { nil: undefined }),
  }).map(({ min, span }) => ({
    ...(min !== undefined ? { min } : {}),
    ...(span !== undefined ? { max: (min ?? 0) + span } : {}),
  }));

/** Presents a shape in one of the ways a schema can be written. */
const presented = (shape: fc.Arbitrary<Shape>): fc.Arbitrary<Model> =>
  fc.record({
    shape,
    nullable: fc.oneof(
      { weight: 5, arbitrary: fc.constant(undefined) },
      { weight: 3, arbitrary: fc.constantFrom("type", "anyOf", "oneOf") },
    ),
    via: fc.oneof(
      { weight: 5, arbitrary: fc.constant(undefined) },
      { weight: 3, arbitrary: fc.constantFrom("ref", "allOf") },
    ),
  }).map(({ shape, nullable, via }): Model => {
    // `enum`, `const` and unions have no `type` to add "null" to.
    const typeless = shape.kind === "enum" || shape.kind === "const" ||
      shape.kind === "union";
    const how = nullable === "type" && typeless ? "anyOf" : nullable;
    return {
      ...shape,
      ...(how !== undefined ? { nullable: how } : {}),
      ...(via !== undefined ? { via } : {}),
    };
  });

const leaf: fc.Arbitrary<Shape> = fc.oneof(
  fc.constant<Shape>({ kind: "boolean" }),
  fc.integer({ min: 1, max: 7 }).map((multipleOf): Shape => ({
    kind: "integer",
    multipleOf,
  })),
  bounds(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }))
    .map(({ min, max }): Shape => ({
      kind: "integer",
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    })),
  bounds(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 1, max: 50 }))
    .map(({ min, max }): Shape => ({
      kind: "number",
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    })),
  bounds(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 5 }))
    .map(({ min, max }): Shape => ({
      kind: "string",
      ...(min !== undefined ? { minLength: min } : {}),
      ...(max !== undefined ? { maxLength: max } : {}),
    })),
  fc.uniqueArray(fc.constantFrom("red", "green", "blue", "", "a b", "é"), {
    minLength: 1,
    maxLength: 4,
  }).map((values): Shape => ({ kind: "enum", values })),
  fc.oneof(fc.constantFrom("fixed", ""), fc.integer(), fc.boolean()).map((
    value,
  ): Shape => ({ kind: "const", value })),
);

const isPlainInteger = (m: Model): boolean =>
  m.kind === "integer" && m.minimum === undefined &&
  m.maximum === undefined && m.multipleOf === undefined &&
  m.nullable === undefined;

export const model: fc.Arbitrary<Model> = fc.letrec<{ node: Model }>((tie) => ({
  node: presented(fc.oneof<fc.Arbitrary<Shape>[]>(
    { maxDepth: 3, depthIdentifier: "model" },
    leaf,
    fc.record({
      items: tie("node"),
      limits: bounds(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 3 }),
      ),
      unique: fc.boolean(),
    }).map(({ items, limits, unique }): Shape => ({
      kind: "array",
      items,
      ...(limits.min !== undefined ? { minItems: limits.min } : {}),
      ...(limits.max !== undefined ? { maxItems: limits.max } : {}),
      // Only where enough distinct items exist for any size.
      ...(unique && isPlainInteger(items) ? { uniqueItems: true } : {}),
    })),
    fc.record({
      names: fc.uniqueArray(fc.constantFrom(...PROPERTY_NAMES), {
        maxLength: 4,
      }),
      closed: fc.boolean(),
    }).chain(({ names, closed }) =>
      fc.tuple(
        ...names.map((name) =>
          fc.record({
            name: fc.constant(name),
            model: tie("node"),
            required: fc.boolean(),
          })
        ),
      ).map((properties): Shape => ({ kind: "object", properties, closed }))
    ),
    tie("node").map((values): Shape => ({ kind: "map", values })),
    fc.record({
      keyword: fc.constantFrom<"oneOf" | "anyOf">("oneOf", "anyOf"),
      candidates: fc.array(tie("node"), { minLength: 2, maxLength: 4 }),
    }).map(({ keyword, candidates }): Shape => {
      // Keep one variant per JSON type. A variant does not accept null:
      // null would belong to every variant that does.
      const variants: Model[] = [];
      for (const candidate of candidates) {
        const type = jsonTypeOf(candidate);
        if (type === undefined) continue;
        if (variants.some((v) => jsonTypeOf(v) === type)) continue;
        const { nullable: _, ...notNullable } = candidate;
        variants.push(notNullable);
      }
      const only = variants[0];
      if (only === undefined) return { kind: "boolean" };
      return variants.length === 1
        ? only
        : { kind: "union", keyword, variants };
    }),
  )),
})).node;

/** A model together with one valid value of it. */
export const modelWithValue: fc.Arbitrary<{ model: Model; value: unknown }> =
  model.chain((m) => validValue(m).map((value) => ({ model: m, value })));
