import type { JsonValue } from "@binference/core";
import type { BinferenceConfig } from "./schema/config.schema.js";
import { type SecretSource, secretSourceSchema } from "./schema/secret-source.schema.js";
import { asJson, isObject, secretKindOf } from "./shown-config.js";

/** A secret source a change adds, at its config key. */
interface AddedSource {
  readonly path: string;
  readonly source: SecretSource;
}

function sourcesOf(
  value: JsonValue,
  path: readonly string[],
): readonly (readonly [string, JsonValue])[] {
  if (secretKindOf(value) !== undefined) {
    return [[path.join("."), value]];
  }
  return isObject(value)
    ? Object.entries(value).flatMap(([key, child]) => sourcesOf(child, [...path, key]))
    : [];
}

/**
 * The secret sources a change adds or changes, by config key, a program's (`fromCommand`) left
 * out: reading one runs the program, which nothing does before the owner's tap (decision 0393).
 */
export function addedSecretSources(
  before: BinferenceConfig,
  after: BinferenceConfig,
): readonly AddedSource[] {
  const was = new Map(
    sourcesOf(asJson(before), []).map(([path, value]) => [path, JSON.stringify(value)]),
  );
  return sourcesOf(asJson(after), []).flatMap(([path, value]) => {
    const parsed = secretSourceSchema.safeParse(value);
    const isNew = was.get(path) !== JSON.stringify(value);
    return parsed.success && isNew && !("fromCommand" in parsed.data)
      ? [{ path, source: parsed.data }]
      : [];
  });
}
