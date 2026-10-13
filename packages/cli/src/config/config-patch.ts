import { configTree } from "./config-json-schema.js";
import { type ConfigNode, nodeAt } from "./config-tree.js";
import { isJsonObject, type JsonObject } from "./json-value.schema.js";
import type { ConfigEdit } from "./migrations/config-edit.js";

// Whether a patch's object at this path merges into the file's, key by key, or replaces one
// value whole: a secret source, an object or a JSON value of the schema is one value.
function mergesAt(node: ConfigNode | undefined): boolean {
  return node !== undefined && node.kind !== "value";
}

function editsAt(patch: JsonObject, path: readonly string[]): readonly ConfigEdit[] {
  return Object.entries(patch).flatMap(([key, value]): readonly ConfigEdit[] => {
    const at = [...path, key];
    if (value === null) {
      return [{ kind: "remove", path: at }];
    }
    return isJsonObject(value) && mergesAt(nodeAt(configTree, at))
      ? editsAt(value, at)
      : [{ kind: "set", path: at, value }];
  });
}

/**
 * The edits a `config/change` patch makes, as a JSON merge patch (RFC 7396) reads: a key set to
 * `null` is removed, an object merges into a group or a map of the config key by key, and any
 * other value replaces the one there whole, as a secret source, an array or a scalar does. A key
 * the config's schema does not know is set as given, so the validation names it.
 */
export function editsOfPatch(patch: JsonObject): readonly ConfigEdit[] {
  return editsAt(patch, []);
}
