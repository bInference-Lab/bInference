import type { Formatter } from "@binference/i18n";
import { configJsonSchema, configTree } from "../config-json-schema.js";
import type { ConfigNode, KeyInfo, ValueRule } from "../config-tree.js";
import { describeRule } from "../describe-rule.js";
import type { JsonObject } from "../json-value.schema.js";
import { envSegment } from "../layers/env-layer.js";
import { currentConfigVersion } from "../migrations/config-migrations.js";
import { defaultKey, describedKey } from "./config-key-texts.js";

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

// English is the schema's own text; another language reads the key's `configKeys` message.
function keyText(key: string, english: string, formatter: Formatter): string {
  return formatter.locale === "en" ? english : formatter.message(key);
}

function defaultOf(info: KeyInfo, place: Place, formatter: Formatter): string {
  if (place.isRequired) {
    return formatter.message("docs.config.required");
  }
  if (info.defaultText !== undefined) {
    const value = keyText(defaultKey(place.path.join(".")), info.defaultText, formatter);
    return formatter.message("docs.config.default", { value });
  }
  return info.defaultValue === undefined
    ? formatter.message("docs.config.noDefault")
    : formatter.message("docs.config.default", {
        value: `\`${JSON.stringify(info.defaultValue)}\``,
      });
}

function ruleText(rule: ValueRule, formatter: Formatter): string {
  return describeRule(rule, (key, values) => formatter.message(`config.${key}`, values));
}

interface KeyText {
  readonly info: KeyInfo;
  /** What the key takes, in the formatter's language. */
  readonly takes: string;
  /** For a map: what its keys' names take. */
  readonly names?: string;
}

function line(place: Place, { info, takes, names }: KeyText, formatter: Formatter): string {
  const variable = `\`BINFERENCE_${place.env.join("__")}\``;
  const path = place.path.join(".");
  const sentences = [
    ...(info.description === undefined
      ? []
      : [keyText(describedKey(path), info.description, formatter)]),
    formatter.message("docs.config.takes", { rule: takes }),
    defaultOf(info, place, formatter),
    formatter.message("docs.config.variable", { variable }),
    ...(names === undefined ? [] : [names]),
  ];
  // Chinese sentences follow each other with no space between them.
  return `- \`${path}\`: ${sentences.join(formatter.locale === "zh" ? "" : " ")}`;
}

type MapNode = Extract<ConfigNode, { readonly kind: "map" }>;

// A map of values is one line; a map of groups is a line for the map, then one per key inside.
function mapLines(node: MapNode, place: Place, formatter: Formatter): readonly string[] {
  const inner: Place = {
    path: [...place.path, `<${node.keyName}>`],
    env: [...place.env, `<${node.keyName.toUpperCase()}>`],
    isRequired: false,
  };
  const names = formatter.message("docs.config.keys", { rule: ruleText(node.keyRule, formatter) });
  if (node.value.kind === "value") {
    const info = { ...node.value.info, ...node.info };
    const takes = ruleText(node.value.rule, formatter);
    return [line(inner, { info, takes, names }, formatter)];
  }
  const takes = formatter.message("config.rule.object");
  return [
    line(place, { info: node.info, takes, names }, formatter),
    ...lines(node.value, inner, formatter),
  ];
}

function lines(node: ConfigNode, place: Place, formatter: Formatter): readonly string[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) =>
      lines(
        child,
        {
          path: [...place.path, key],
          env: [...place.env, envSegment(key)],
          isRequired: node.required.has(key),
        },
        formatter,
      ),
    );
  }
  return node.kind === "map"
    ? mapLines(node, place, formatter)
    : [line(place, { info: node.info, takes: ruleText(node.rule, formatter) }, formatter)];
}

type Section = readonly [key: string, node: ConfigNode];

function section(
  [key, node]: Section,
  required: ReadonlySet<string>,
  formatter: Formatter,
): string {
  const place: Place = { path: [key], env: [envSegment(key)], isRequired: required.has(key) };
  const { description } = node.info;
  const described =
    description === undefined ? "" : keyText(describedKey(key), description, formatter);
  const heading = [`## \`${key}\``, "", described, ""];
  return [...heading, ...lines(node, place, formatter), ""].join("\n");
}

/**
 * The reference of every config key as Markdown in the formatter's language: what it takes, its
 * default and its variable, generated from the schema, under a `##` heading per top-level key.
 * The keys' texts come from their `configKeys` messages in that language. `pnpm docs:gen`
 * writes it into the docs site, and `check:references` fails when the site's copy is behind.
 */
export function renderConfigReference(formatter: Formatter): string {
  const root = configTree;
  if (root.kind !== "group") {
    return "";
  }
  const intro = formatter.message("docs.config.intro", {
    version: String(currentConfigVersion),
    flag: "`--set <key>=<value>`",
  });
  const sections = [...root.keys].map((entry) => section(entry, root.required, formatter));
  return [intro, "", ...sections].join("\n");
}
