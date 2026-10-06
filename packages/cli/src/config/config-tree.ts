import { isJsonObject, type JsonObject, type JsonValue } from "./json-value.schema.js";
import type { ValueFormat } from "./schema/value-formats.schema.js";

/** What a config value accepts, read from the config's JSON Schema. */
export type ValueRule =
  | { readonly kind: "integer" | "number"; readonly min?: number; readonly max?: number }
  | { readonly kind: "text"; readonly format?: ValueFormat }
  | { readonly kind: "choice"; readonly allowed: readonly (string | number | boolean)[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "list"; readonly item: ValueRule }
  | { readonly kind: "object" }
  | { readonly kind: "json" }
  | { readonly kind: "secret"; readonly commandOnly: boolean }
  | { readonly kind: "either"; readonly options: readonly ValueRule[] };

/** A key's description and default, for issues and the generated reference. */
export interface KeyInfo {
  readonly description?: string;
  readonly defaultValue?: JsonValue;
  /** A default that depends on the machine, such as `from the OS`. */
  readonly defaultText?: string;
}

/** One node of the config: a group of named keys, a map of free keys, or a value. */
export type ConfigNode =
  | {
      readonly kind: "group";
      readonly keys: ReadonlyMap<string, ConfigNode>;
      readonly required: ReadonlySet<string>;
      readonly info: KeyInfo;
    }
  | {
      readonly kind: "map";
      /** What a key stands for, such as `chain` in `chains.rpc.<chain>`. */
      readonly keyName: string;
      readonly keyRule: ValueRule;
      readonly value: ConfigNode;
      readonly info: KeyInfo;
    }
  | { readonly kind: "value"; readonly rule: ValueRule; readonly info: KeyInfo };

const formats: readonly ValueFormat[] = [
  "url",
  "model",
  "time_zone",
  "chain",
  "decimal",
  "path",
  "keychain_name",
  "env_name",
];

// JSON Schema writes no maximum on most integers, but zod writes the largest safe one.
const noLimit = 1e12;

function text(node: JsonObject, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}

function limit(node: JsonObject, key: string): number | undefined {
  const value = node[key];
  return typeof value === "number" && Math.abs(value) < noLimit ? value : undefined;
}

function infoOf(node: JsonObject): KeyInfo {
  const description = text(node, "description");
  const defaultText = text(node, "defaultText");
  const defaultValue = node["default"];
  return {
    ...(description === undefined ? {} : { description }),
    ...(defaultText === undefined ? {} : { defaultText }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
  };
}

function numberRule(node: JsonObject, kind: "integer" | "number"): ValueRule {
  const exclusive = limit(node, "exclusiveMinimum");
  const min = limit(node, "minimum") ?? (exclusive === undefined ? undefined : exclusive + 1);
  const max = limit(node, "maximum");
  return { kind, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

function textRule(node: JsonObject): ValueRule {
  const named = text(node, "valueFormat") ?? (text(node, "format") === "uri" ? "url" : undefined);
  const format = formats.find((item) => item === named);
  return format === undefined ? { kind: "text" } : { kind: "text", format };
}

function choices(node: JsonObject): readonly (string | number | boolean)[] | undefined {
  const listed = node["enum"] ?? (node["const"] === undefined ? undefined : [node["const"]]);
  if (!Array.isArray(listed)) {
    return undefined;
  }
  return listed.filter(
    (item): item is string | number | boolean =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean",
  );
}

interface Reader {
  rule(node: JsonObject): ValueRule;
  node(node: JsonObject): ConfigNode;
}

const byType: Readonly<Record<string, (node: JsonObject, reader: Reader) => ValueRule>> = {
  integer: (node) => numberRule(node, "integer"),
  number: (node) => numberRule(node, "number"),
  string: (node) => textRule(node),
  boolean: () => ({ kind: "boolean" }),
  array: (node, reader) => {
    const items = node["items"];
    return { kind: "list", item: isJsonObject(items) ? reader.rule(items) : { kind: "json" } };
  },
  object: () => ({ kind: "object" }),
};

function typedRule(reader: Reader, node: JsonObject): ValueRule {
  const allowed = choices(node);
  if (allowed !== undefined) {
    return { kind: "choice", allowed };
  }
  const type = node["type"];
  const read = typeof type === "string" ? byType[type] : undefined;
  return read === undefined ? { kind: "json" } : read(node, reader);
}

function createReader(): Reader {
  const reader: Reader = {
    rule: (node) => {
      const ref = text(node, "$ref")?.replace("#/$defs/", "");
      if (ref === "Secret" || ref === "CommandSecret") {
        return { kind: "secret", commandOnly: ref === "CommandSecret" };
      }
      const options = node["anyOf"];
      if (Array.isArray(options)) {
        const rules = options.filter(isJsonObject).map((option) => reader.rule(option));
        return { kind: "either", options: rules };
      }
      return ref === undefined ? typedRule(reader, node) : { kind: "json" };
    },
    node: (node) => readNode(reader, node),
  };
  return reader;
}

function readNode(reader: Reader, node: JsonObject): ConfigNode {
  const info = infoOf(node);
  const properties = node["properties"];
  if (node["type"] === "object" && isJsonObject(properties)) {
    const required = node["required"];
    return {
      kind: "group",
      keys: new Map(
        Object.entries(properties)
          .filter((entry): entry is [string, JsonObject] => isJsonObject(entry[1]))
          .map(([key, child]) => [key, reader.node(child)]),
      ),
      required: new Set(
        Array.isArray(required) ? required.filter((key) => typeof key === "string") : [],
      ),
      info,
    };
  }
  const values = node["additionalProperties"];
  const names = node["propertyNames"];
  if (node["type"] === "object" && isJsonObject(values)) {
    return {
      kind: "map",
      keyName: text(node, "keyName") ?? "key",
      keyRule: isJsonObject(names) ? reader.rule(names) : { kind: "text" },
      value: reader.node(values),
      info,
    };
  }
  return { kind: "value", rule: reader.rule(node), info };
}

/**
 * Reads the config's JSON Schema into a tree of groups, maps and values. A reference to `Secret`
 * or `CommandSecret` is a secret value; any other reference is a free JSON value.
 */
export function readConfigTree(schema: JsonObject): ConfigNode {
  return createReader().node(schema);
}

/** The node a path leads to: a group's key, or any key of a map. */
export function childOf(node: ConfigNode, key: string): ConfigNode | undefined {
  if (node.kind === "group") {
    return node.keys.get(key);
  }
  return node.kind === "map" ? node.value : undefined;
}

/** The node at a path, or `undefined` when the path leaves the config's shape. */
export function nodeAt(root: ConfigNode, path: readonly string[]): ConfigNode | undefined {
  return path.reduce<ConfigNode | undefined>(
    (node, key) => (node === undefined ? undefined : childOf(node, key)),
    root,
  );
}
