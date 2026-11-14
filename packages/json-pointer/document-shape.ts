/**
 * Shape of a parsed document as an object graph.
 *
 * A JSON text always parses to a tree. A YAML text does not: an alias makes
 * two locations hold the same object, and an alias to an ancestor makes an
 * object contain itself. Code that walks a document by its keys assumes a
 * tree, so on such input it repeats work once per path (exponential for
 * nested aliases) or never ends.
 *
 * `inspectDocument` measures the graph once, in time and memory linear in
 * the number of distinct nodes and without using the call stack, so the
 * caller can decide at its boundary whether the document is safe to treat
 * as a tree.
 */

import type { PointerPath } from "./json-pointer.ts";

export interface DocumentShape {
  /** Distinct objects and arrays. */
  nodes: number;
  /**
   * Objects and arrays when a shared node is counted once for every path
   * that reaches it: the size of the document written out as a tree, which
   * is what a walk by keys visits. `Infinity` when it exceeds the range of a
   * number. Not meaningful when `cycle` is set.
   */
  expandedNodes: number;
  /** Levels of nesting below the root. A primitive or an empty root is 0. */
  depth: number;
  /** Path to a node at that depth. */
  deepestPath: PointerPath;
  /** Set when a node contains itself. */
  cycle?: {
    /** Path of the reference that closes the cycle. */
    path: PointerPath;
    /** Path of the node it refers back to. */
    ancestor: PointerPath;
  };
}

type Node = Record<string, unknown> | unknown[];

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

interface Frame {
  node: Node;
  /** Set when the node is an array. Its children are walked by index. */
  items: unknown[] | null;
  /** Set when the node is an object. Its children are walked by key. */
  fields: Record<string, unknown> | null;
  /** Keys of `fields`. */
  keys: string[];
  /** Index of the next child to look at. */
  next: number;
  /** Segment under which the parent holds this node. Unused for the root. */
  segment: string;
  /** Sum of the expanded sizes of the children seen so far. */
  expanded: number;
  /** Greatest height among the children seen so far, or -1 for none. */
  childHeight: number;
  /** Segment of the child with that height. */
  tallestSegment: string;
}

interface Measured {
  expanded: number;
  /** Levels of nesting below this node. */
  height: number;
  /** Segment of the child that leads to the deepest node, if any. */
  tallestSegment: string | null;
}

function frameFor(node: Node, segment: string): Frame {
  const items = Array.isArray(node) ? node : null;
  const fields = Array.isArray(node) ? null : node;
  return {
    node,
    items,
    fields,
    keys: fields === null ? [] : Object.keys(fields),
    next: 0,
    segment,
    expanded: 0,
    childHeight: -1,
    tallestSegment: "",
  };
}

export function inspectDocument(document: unknown): DocumentShape {
  if (!isNode(document)) {
    return { nodes: 0, expandedNodes: 0, depth: 0, deepestPath: [] };
  }

  // Finished nodes. A node is measured once, however many paths reach it.
  const measured = new Map<Node, Measured>();
  // Nodes on the current path, with their position in `stack`.
  const onPath = new Map<Node, number>();
  const stack: Frame[] = [frameFor(document, "")];
  onPath.set(document, 0);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const count = frame.items !== null ? frame.items.length : frame.keys.length;

    if (frame.next < count) {
      const index = frame.next++;
      let segment: string;
      let child: unknown;
      if (frame.items !== null) {
        segment = String(index);
        child = frame.items[index];
      } else {
        segment = frame.keys[index] ?? "";
        child = frame.fields?.[segment];
      }
      if (!isNode(child)) continue;

      const done = measured.get(child);
      if (done !== undefined) {
        frame.expanded += done.expanded;
        if (done.height > frame.childHeight) {
          frame.childHeight = done.height;
          frame.tallestSegment = segment;
        }
        continue;
      }

      const ancestorIndex = onPath.get(child);
      if (ancestorIndex !== undefined) {
        const path = stack.slice(1).map((f) => f.segment);
        path.push(segment);
        return {
          nodes: measured.size + stack.length,
          expandedNodes: Infinity,
          depth: stack.length,
          deepestPath: path,
          cycle: {
            path,
            ancestor: stack.slice(1, ancestorIndex + 1).map((f) => f.segment),
          },
        };
      }

      onPath.set(child, stack.length);
      stack.push(frameFor(child, segment));
      continue;
    }

    // All children seen: the node is measured.
    stack.pop();
    onPath.delete(frame.node);
    const result: Measured = {
      expanded: 1 + frame.expanded,
      height: frame.childHeight + 1,
      tallestSegment: frame.childHeight >= 0 ? frame.tallestSegment : null,
    };
    measured.set(frame.node, result);

    const parent = stack[stack.length - 1];
    if (parent !== undefined) {
      parent.expanded += result.expanded;
      if (result.height > parent.childHeight) {
        parent.childHeight = result.height;
        parent.tallestSegment = frame.segment;
      }
    }
  }

  const root = measured.get(document);
  if (root === undefined) {
    throw new Error("inspectDocument: the root node was not measured");
  }

  // Follow the tallest child from the root to recover the deepest path.
  const deepestPath: string[] = [];
  let current: unknown = document;
  while (isNode(current)) {
    const info = measured.get(current);
    if (info === undefined || info.tallestSegment === null) break;
    deepestPath.push(info.tallestSegment);
    current = Array.isArray(current)
      ? current[Number(info.tallestSegment)]
      : current[info.tallestSegment];
  }

  return {
    nodes: measured.size,
    expandedNodes: root.expanded,
    depth: root.height,
    deepestPath,
  };
}
