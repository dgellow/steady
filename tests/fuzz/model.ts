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

export type Model =
  | { kind: "boolean" }
  | { kind: "integer"; minimum?: number; maximum?: number }
  | { kind: "number"; minimum?: number; maximum?: number }
  | { kind: "string"; minLength?: number; maxLength?: number }
  | { kind: "enum"; values: string[] }
  | { kind: "const"; value: string | number | boolean }
  | { kind: "array"; items: Model; minItems?: number; maxItems?: number }
  | {
    kind: "object";
    properties: { name: string; model: Model; required: boolean }[];
    /** `additionalProperties: false` */
    closed: boolean;
  };

// ── Model to schema ─────────────────────────────────────────────────

export function toSchema(model: Model): Record<string, unknown> {
  switch (model.kind) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
    case "number":
      return {
        type: model.kind,
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
        items: toSchema(model.items),
        ...(model.minItems !== undefined ? { minItems: model.minItems } : {}),
        ...(model.maxItems !== undefined ? { maxItems: model.maxItems } : {}),
      };
    case "object": {
      const required = model.properties.filter((p) => p.required).map((p) =>
        p.name
      );
      return {
        type: "object",
        properties: Object.fromEntries(
          model.properties.map((p) => [p.name, toSchema(p.model)]),
        ),
        ...(required.length > 0 ? { required } : {}),
        ...(model.closed ? { additionalProperties: false } : {}),
      };
    }
  }
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
  switch (model.kind) {
    case "boolean":
      return fc.boolean();
    case "integer":
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
    case "array":
      return fc.array(validValue(model.items), {
        minLength: model.minItems ?? 0,
        maxLength: model.maxItems ?? (model.minItems ?? 0) + 3,
      });
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
      return "a string";
    case "enum":
    case "const":
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
   */
  const visit = (
    node: Model,
    current: unknown,
    path: string[],
    isArrayItem: boolean,
    inOptionalProperty: boolean,
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
    const other = valueOfOtherType(node);
    if (other !== undefined) {
      add("value of another type", other, {
        code: typeCode,
        path,
        rejects: true,
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
          if (fraction !== undefined) {
            add("a fraction where an integer is required", fraction, {
              code: typeCode,
              path,
              rejects: true,
            });
          }
        }
        numberBounds(node.minimum, node.maximum);
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
          while (longer.length <= node.maxItems) longer.push(current[0]);
          add("array longer than maxItems", longer, {
            code: "E4005",
            path,
            rejects: false,
          });
        }
        current.forEach((item, index) =>
          visit(node.items, item, [...path, String(index)], true, false)
        );
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

const leaf: fc.Arbitrary<Model> = fc.oneof(
  fc.constant<Model>({ kind: "boolean" }),
  bounds(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }))
    .map(({ min, max }): Model => ({
      kind: "integer",
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    })),
  bounds(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 1, max: 50 }))
    .map(({ min, max }): Model => ({
      kind: "number",
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    })),
  bounds(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 5 }))
    .map(({ min, max }): Model => ({
      kind: "string",
      ...(min !== undefined ? { minLength: min } : {}),
      ...(max !== undefined ? { maxLength: max } : {}),
    })),
  fc.uniqueArray(fc.constantFrom("red", "green", "blue", "", "a b", "é"), {
    minLength: 1,
    maxLength: 4,
  }).map((values): Model => ({ kind: "enum", values })),
  fc.oneof(fc.constantFrom("fixed", ""), fc.integer(), fc.boolean()).map((
    value,
  ): Model => ({ kind: "const", value })),
);

export const model: fc.Arbitrary<Model> = fc.letrec<{ node: Model }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, depthIdentifier: "model" },
    leaf,
    fc.record({
      items: tie("node"),
      limits: bounds(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 3 }),
      ),
    }).map(({ items, limits }): Model => ({
      kind: "array",
      items,
      ...(limits.min !== undefined ? { minItems: limits.min } : {}),
      ...(limits.max !== undefined ? { maxItems: limits.max } : {}),
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
      ).map((properties): Model => ({ kind: "object", properties, closed }))
    ),
  ),
})).node;

/** A model together with one valid value of it. */
export const modelWithValue: fc.Arbitrary<{ model: Model; value: unknown }> =
  model.chain((m) => validValue(m).map((value) => ({ model: m, value })));
