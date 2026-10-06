import { isJsonObject, type JsonObject, type JsonValue } from "../json-value.schema.js";

/**
 * One change a config migration makes to the file, by key path. Edits are data, so `check --fix`
 * can print each one and apply it to the file's text without losing its comments.
 */
export type ConfigEdit =
  | { readonly kind: "set"; readonly path: readonly string[]; readonly value: JsonValue }
  | { readonly kind: "remove"; readonly path: readonly string[] }
  | { readonly kind: "move"; readonly from: readonly string[]; readonly to: readonly string[] };

/** The value at a path, or `undefined` when a key on the way is missing. */
export function valueAt(file: JsonObject, path: readonly string[]): JsonValue | undefined {
  return path.reduce<JsonValue | undefined>(
    (value, key) => (isJsonObject(value) ? value[key] : undefined),
    file,
  );
}

function withValue(
  object: JsonObject,
  path: readonly string[],
  value: JsonValue | undefined,
): JsonObject {
  const [key, ...rest] = path;
  if (key === undefined) {
    return object;
  }
  if (rest.length === 0) {
    return value === undefined
      ? Object.fromEntries(Object.entries(object).filter(([name]) => name !== key))
      : { ...object, [key]: value };
  }
  const child = object[key];
  if (!isJsonObject(child) && value === undefined) {
    return object;
  }
  return { ...object, [key]: withValue(isJsonObject(child) ? child : {}, rest, value) };
}

/**
 * Applies edits in order and returns the new file; the input is never changed. Removing a missing
 * key and moving one that is gone change nothing, so applying the same edits twice is safe.
 */
export function applyEdits(file: JsonObject, edits: readonly ConfigEdit[]): JsonObject {
  return edits.reduce<JsonObject>((current, edit) => {
    if (edit.kind === "set") {
      return withValue(current, edit.path, edit.value);
    }
    if (edit.kind === "remove") {
      return withValue(current, edit.path, undefined);
    }
    const value = valueAt(current, edit.from);
    return value === undefined
      ? current
      : withValue(withValue(current, edit.from, undefined), edit.to, value);
  }, file);
}
