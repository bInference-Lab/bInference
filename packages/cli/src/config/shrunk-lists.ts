import type { JsonValue } from "@binference/core";
import type { BinferenceConfig } from "./schema/config.schema.js";
import { asJson, isObject } from "./shown-config.js";

function listsOf(
  value: JsonValue,
  path: readonly string[],
): readonly (readonly [string, JsonValue])[] {
  if (Array.isArray(value)) {
    return [[path.join("."), value]];
  }
  return isObject(value)
    ? Object.entries(value).flatMap(([key, child]) => listsOf(child, [...path, key]))
    : [];
}

function valueAt(root: JsonValue, path: string): JsonValue | undefined {
  return path
    .split(".")
    .reduce<JsonValue | undefined>(
      (node, key) => (node !== undefined && isObject(node) ? node[key] : undefined),
      root,
    );
}

// Whether a list after the change still holds every entry it held before.
function keepsAll(before: JsonValue, after: JsonValue | undefined): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) {
    return !Array.isArray(before) || before.length === 0;
  }
  const kept = new Set(after.map((entry) => JSON.stringify(entry)));
  return before.every((entry) => kept.has(JSON.stringify(entry)));
}

/**
 * The config's lists a change drops entries from, by key (decision 0395): a list it replaces with
 * fewer entries, or removes while it held any. A change names such a list in `replacePaths` when
 * it means to drop them.
 */
export function shrunkLists(before: BinferenceConfig, after: BinferenceConfig): readonly string[] {
  const now = asJson(after);
  return listsOf(asJson(before), [])
    .filter(([path, list]) => !keepsAll(list, valueAt(now, path)))
    .map(([path]) => path);
}
