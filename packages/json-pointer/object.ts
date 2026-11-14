/**
 * Own-property access for objects used as string-keyed maps.
 *
 * A JSON object, a `properties` map in a schema, a parsed query string: each
 * is a map from arbitrary names to values. In JavaScript such an object also
 * inherits the members of `Object.prototype`, so `"toString" in map` is true
 * and `map["constructor"]` is a function for every map. Whenever the key
 * comes from a request or a spec, test membership with `Object.hasOwn` and
 * read with `getOwn`, not with `in` and `map[key]`.
 *
 * Writing needs no counterpart: Deno removes the `__proto__` accessor from
 * `Object.prototype`, so `map[key] = value` creates a member for every key.
 */

/**
 * The value stored under `key` in the map itself, or `undefined` when the
 * map has no such member. Inherited members are never returned.
 */
export function getOwn<T>(
  map: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}
