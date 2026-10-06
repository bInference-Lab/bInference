import type { ConfigOrigin } from "../config-issue.js";
import type { ConfigNode, ValueRule } from "../config-tree.js";
import { type JsonValue, jsonValueSchema } from "../json-value.schema.js";

/** One value a layer sets: where in the config, the value, and the file, variable or flag. */
export interface LayerEntry {
  readonly path: readonly string[];
  readonly value: JsonValue;
  readonly origin: ConfigOrigin;
}

// Which kinds of value take an environment variable's text as it is, without reading JSON.
const textKinds: ReadonlySet<ValueRule["kind"]> = new Set(["text"]);

function takesTextAsIs(rule: ValueRule): boolean {
  return (
    textKinds.has(rule.kind) ||
    (rule.kind === "choice" && rule.allowed.every((item) => typeof item === "string"))
  );
}

function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the text of an environment variable or a `--set` flag as the value its key takes: text
 * stays text, and numbers, booleans, lists, objects and secret sources are read as JSON. Text
 * that is not JSON stays text, so validation names the key and what it takes.
 */
export function readLayerText(node: ConfigNode | undefined, text: string): JsonValue {
  if (node?.kind === "value" && takesTextAsIs(node.rule)) {
    return text;
  }
  return parseJson(text) ?? text;
}
