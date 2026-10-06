import { configJsonSchema, configTree } from "../config-json-schema.js";
import type { ConfigNode, KeyInfo } from "../config-tree.js";
import { describeRule } from "../describe-rule.js";
import type { JsonObject } from "../json-value.schema.js";
import { envSegment } from "../layers/env-layer.js";
import { currentConfigVersion } from "../migrations/config-migrations.js";

/** The config schema as `check:config-schema` records it: the file's version and its JSON Schema. */
export interface ConfigSchemaSnapshot {
  readonly version: number;
  readonly schema: JsonObject;
}

/** The current config version and JSON Schema, for the committed snapshot and editors. */
export function describeConfigSchema(): ConfigSchemaSnapshot {
  return { version: currentConfigVersion, schema: configJsonSchema };
}

interface Place {
  /** The key path as the file writes it, with `<name>` for a map's keys. */
  readonly path: readonly string[];
  /** The `BINFERENCE_` variable's segments. */
  readonly env: readonly string[];
  readonly isRequired: boolean;
}

function defaultOf(info: KeyInfo, place: Place): string {
  if (place.isRequired) {
    return "Required.";
  }
  if (info.defaultText !== undefined) {
    return `Default: ${info.defaultText}.`;
  }
  return info.defaultValue === undefined
    ? "Default: none."
    : `Default: \`${JSON.stringify(info.defaultValue)}\`.`;
}

function line(place: Place, info: KeyInfo, takes: string): string {
  const variable = `BINFERENCE_${place.env.join("__")}`;
  return [
    `- \`${place.path.join(".")}\`:`,
    ...(info.description === undefined ? [] : [info.description]),
    `Takes ${takes}.`,
    defaultOf(info, place),
    `Variable: \`${variable}\`.`,
  ].join(" ");
}

type MapNode = Extract<ConfigNode, { readonly kind: "map" }>;

// A map of values is one line; a map of groups is a line for the map, then one per key inside.
function mapLines(node: MapNode, place: Place): readonly string[] {
  const inner: Place = {
    path: [...place.path, `<${node.keyName}>`],
    env: [...place.env, `<${node.keyName.toUpperCase()}>`],
    isRequired: false,
  };
  const keys = `Keys: ${describeRule(node.keyRule)}.`;
  if (node.value.kind === "value") {
    const info = { ...node.value.info, ...node.info };
    return [`${line(inner, info, describeRule(node.value.rule))} ${keys}`];
  }
  return [`${line(place, node.info, "an object")} ${keys}`, ...lines(node.value, inner)];
}

function lines(node: ConfigNode, place: Place): readonly string[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) =>
      lines(child, {
        path: [...place.path, key],
        env: [...place.env, envSegment(key)],
        isRequired: node.required.has(key),
      }),
    );
  }
  return node.kind === "map"
    ? mapLines(node, place)
    : [line(place, node.info, describeRule(node.rule))];
}

function section(key: string, node: ConfigNode, required: ReadonlySet<string>): string {
  const place: Place = { path: [key], env: [envSegment(key)], isRequired: required.has(key) };
  const heading = [`## \`${key}\``, "", node.info.description ?? "", ""];
  return [...heading, ...lines(node, place), ""].join("\n");
}

/**
 * The reference of every config key as Markdown: what it takes, its default and its variable,
 * generated from the schema. `check:config-schema` fails when the committed copy is behind.
 */
export function renderConfigReference(): string {
  const root = configTree;
  if (root.kind !== "group") {
    return "";
  }
  const sections = [...root.keys].map(([key, node]) => section(key, node, root.required));
  return [
    "# Config keys",
    "",
    "This file is generated from the config schema by `pnpm check:config-schema --write`. Change " +
      "the schema in `packages/cli/src/config/schema/`, never this file.",
    "",
    `This binference reads \`config.json5\` version ${String(currentConfigVersion)}. Each key is ` +
      "set in the file, by its variable, or by `--set <key>=<value>`, and a later layer wins. " +
      "A secret is always a secret source, never the secret itself.",
    "",
    ...sections,
  ].join("\n");
}
