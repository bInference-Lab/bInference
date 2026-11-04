import { configTree } from "../config-json-schema.js";
import type { ConfigNode, KeyInfo } from "../config-tree.js";

/** The `configKeys` message of a key's `.describe()` text, by its path: `engine.port`. */
export function describedKey(path: string): string {
  return `configKeys.${path}`;
}

/** The `configKeys` message of a key's machine-dependent default: `owner.locale:default`. */
export function defaultKey(path: string): string {
  return `configKeys.${path}:default`;
}

function infoTexts(path: string, info: KeyInfo): readonly (readonly [string, string])[] {
  return [
    ...(info.description === undefined ? [] : [[describedKey(path), info.description] as const]),
    ...(info.defaultText === undefined ? [] : [[defaultKey(path), info.defaultText] as const]),
  ];
}

// The texts of a node's lines, as the reference writes them: a group shows only its keys' lines,
// a map of values one line at its inner path with its own info over its value's, and a map of
// groups a line of its own, then its value's lines.
function lineTexts(node: ConfigNode, path: string): readonly (readonly [string, string])[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) => lineTexts(child, `${path}.${key}`));
  }
  if (node.kind === "value") {
    return infoTexts(path, node.info);
  }
  const inner = `${path}.<${node.keyName}>`;
  return node.value.kind === "value"
    ? infoTexts(inner, { ...node.value.info, ...node.info })
    : [...infoTexts(path, node.info), ...lineTexts(node.value, inner)];
}

// A section's heading shows its description, never its default.
function headingText(key: string, node: ConfigNode): readonly (readonly [string, string])[] {
  return node.info.description === undefined ? [] : [[describedKey(key), node.info.description]];
}

/**
 * Every text of the config schema the reference shows, its `.describe()` texts and its
 * machine-dependent defaults, by the `configKeys` message that says it in each language. The
 * English messages are these texts; `pnpm docs:gen` writes them and `check:references` fails a
 * catalog behind the schema.
 */
export function configKeyTexts(): ReadonlyMap<string, string> {
  if (configTree.kind !== "group") {
    return new Map();
  }
  return new Map(
    [...configTree.keys].flatMap(([key, node]) =>
      headingText(key, node).concat(lineTexts(node, key)),
    ),
  );
}
