import { type ConfigOrigin, defaultOrigin } from "../config-issue.js";
import { childOf, type ConfigNode, nodeAt } from "../config-tree.js";
import { isJsonObject, type JsonObject, type JsonValue } from "../json-value.schema.js";
import type { LayerEntry } from "./layer-entry.js";

/** The layers merged into one input, and the origin of each key a layer set. */
export interface MergedLayers {
  readonly value: JsonObject;
  /** Keyed by the dotted path; a key no layer set has no entry. */
  readonly origins: ReadonlyMap<string, ConfigOrigin>;
}

// Groups and maps merge key by key; a value, such as a list or a secret source, is replaced whole.
function isMerged(node: ConfigNode | undefined): boolean {
  return node !== undefined && node.kind !== "value";
}

function mergeValue(
  node: ConfigNode | undefined,
  lower: JsonValue | undefined,
  higher: JsonValue,
): JsonValue {
  if (!isMerged(node) || !isJsonObject(lower) || !isJsonObject(higher)) {
    return higher;
  }
  const merged = Object.entries(higher).map(([key, value]): [string, JsonValue] => [
    key,
    node === undefined ? value : mergeValue(childOf(node, key), lower[key], value),
  ]);
  return { ...lower, ...Object.fromEntries(merged) };
}

function setAt(
  node: ConfigNode | undefined,
  lower: JsonValue | undefined,
  entry: LayerEntry,
): JsonValue {
  const [key, ...rest] = entry.path;
  if (key === undefined) {
    return mergeValue(node, lower, entry.value);
  }
  const base = isJsonObject(lower) ? lower : {};
  const child = node === undefined ? undefined : childOf(node, key);
  return { ...base, [key]: setAt(child, base[key], { ...entry, path: rest }) };
}

function record(
  origins: Map<string, ConfigOrigin>,
  node: ConfigNode | undefined,
  entry: LayerEntry,
): void {
  const dotted = entry.path.join(".");
  if (entry.path.length > 0) {
    origins.set(dotted, entry.origin);
  }
  if (!isMerged(node) || !isJsonObject(entry.value)) {
    // A value replaced whole leaves nothing below it from a lower layer.
    for (const key of origins.keys()) {
      if (key.startsWith(`${dotted}.`)) {
        origins.delete(key);
      }
    }
    return;
  }
  for (const [key, value] of Object.entries(entry.value)) {
    const child = node === undefined ? undefined : childOf(node, key);
    record(origins, child, { path: [...entry.path, key], value, origin: entry.origin });
  }
}

/**
 * Merges layer entries in order, lowest first: a higher layer replaces a lower one key by key.
 * Lists and secret sources are replaced whole, never merged.
 */
export function mergeLayers(root: ConfigNode, entries: readonly LayerEntry[]): MergedLayers {
  const origins = new Map<string, ConfigOrigin>();
  let value: JsonValue = {};
  for (const entry of entries) {
    value = setAt(root, value, entry);
    record(origins, nodeAt(root, entry.path), entry);
  }
  return { value: isJsonObject(value) ? value : {}, origins };
}

/** Where the value at a path came from: its own entry, else the nearest key above it that a layer set. */
export function originOf(
  origins: ReadonlyMap<string, ConfigOrigin>,
  path: readonly string[],
): ConfigOrigin {
  for (let length = path.length; length > 0; length -= 1) {
    const origin = origins.get(path.slice(0, length).join("."));
    if (origin !== undefined) {
      return origin;
    }
  }
  return defaultOrigin;
}
