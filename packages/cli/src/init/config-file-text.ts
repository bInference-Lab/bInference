import { childOf, type ConfigNode } from "../config/config-tree.js";
import { isJsonObject, type JsonObject, type JsonValue } from "../config/json-value.schema.js";

const header = [
  "// The binference config file (docs/specs/config.md), written by binference init.",
  "// Secrets are named by their sources, never written here. binference check validates it.",
];
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function keyText(key: string): string {
  return identifier.test(key) ? key : JSON.stringify(key);
}

// A value on one line: scalars as JSON, lists and objects such as a secret source in braces.
function inline(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(inline).join(", ")}]`;
  }
  if (isJsonObject(value)) {
    const fields = Object.entries(value).map(([key, item]) => `${keyText(key)}: ${inline(item)}`);
    return fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function block(value: JsonObject, node: ConfigNode | undefined, indent: string): string {
  const inner = `${indent}  `;
  const lines = ["{"];
  for (const [key, item] of Object.entries(value)) {
    const child = node === undefined ? undefined : childOf(node, key);
    const description = child?.info.description;
    if (description !== undefined) {
      lines.push(`${inner}// ${description}`);
    }
    lines.push(`${inner}${keyText(key)}: ${text(item, child, inner)},`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

// Groups and maps take a block with a comment over each key; a value stays on its line.
function text(value: JsonValue, node: ConfigNode | undefined, indent: string): string {
  return isJsonObject(value) && node?.kind !== "value" ? block(value, node, indent) : inline(value);
}

/**
 * Writes a config as the text of `config.json5`: JSON5 with a comment over every key it sets,
 * taken from the key's description in the schema, and a secret source on one line.
 */
export function configFileText(value: JsonObject, root: ConfigNode): string {
  return `${[...header, block(value, root, "")].join("\n")}\n`;
}
