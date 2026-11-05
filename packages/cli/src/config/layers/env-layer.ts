import { type ConfigIssue, configIssue } from "../config-issue.js";
import { childOf, type ConfigNode } from "../config-tree.js";
import { type LayerEntry, readLayerText } from "./layer-entry.js";

/** The prefix of every variable that sets a config key. */
const prefix = "BINFERENCE_";

// Variables with the prefix that are not config keys: BINFERENCE_HOME moves the state folder,
// BINFERENCE_MCP_TOKEN carries an MCP session's secret, BINFERENCE_PLUGIN_LAUNCHER and
// BINFERENCE_IMAGE_USER name the image's plugin launcher and its own user (decision 0344), and
// BINFERENCE_NODE_MIRROR is the install script's Node mirror.
const reserved: ReadonlySet<string> = new Set([
  "BINFERENCE_HOME",
  "BINFERENCE_MCP_TOKEN",
  "BINFERENCE_PLUGIN_LAUNCHER",
  "BINFERENCE_IMAGE_USER",
  "BINFERENCE_NODE_MIRROR",
]);

// The install script's own variables, such as BINFERENCE_INSTALL_CHANNEL. The script runs init
// with them still set, and the service init starts inherits them.
const installVariablePrefix = `${prefix}INSTALL_`;

/**
 * The prefix of the variables that answer `binference init` (decision 0224). None is a config
 * key, so they may stay set for the engine, as in a container.
 */
export const initVariablePrefix: string = `${prefix}INIT_`;

function isConfigVariable(name: string): boolean {
  return (
    name.startsWith(prefix) &&
    !reserved.has(name) &&
    !name.startsWith(initVariablePrefix) &&
    !name.startsWith(installVariablePrefix)
  );
}

/** The variable segment of a key: `webhookPort` is `WEBHOOK_PORT`. */
export function envSegment(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** What the environment layer found: its entries, and the variables that name no key. */
export interface EnvLayer {
  readonly entries: readonly LayerEntry[];
  readonly issues: readonly ConfigIssue[];
}

function keyFor(node: ConfigNode, segment: string): string | undefined {
  if (node.kind === "group") {
    return [...node.keys.keys()].find((key) => envSegment(key) === segment);
  }
  return node.kind === "map" ? segment.toLowerCase() : undefined;
}

interface Walk {
  readonly path: readonly string[];
  readonly node: ConfigNode | undefined;
}

// Follows the segments through the config's shape; a segment no key matches ends the walk.
function walk(root: ConfigNode, segments: readonly string[]): Walk {
  let node: ConfigNode | undefined = root;
  const path: string[] = [];
  for (const segment of segments) {
    const key = node === undefined || segment === "" ? undefined : keyFor(node, segment);
    if (node === undefined || key === undefined) {
      return {
        path: [...path, ...segments.slice(path.length).map((s) => s.toLowerCase())],
        node: undefined,
      };
    }
    path.push(key);
    node = childOf(node, key);
  }
  return { path, node };
}

/**
 * Reads the `BINFERENCE_*` variables as a layer: `BINFERENCE_ENGINE__PORT=7460` sets
 * `engine.port`, `__` between segments, and a map's key in lower case. Lists, objects and secret
 * sources take JSON. An empty variable counts as unset; one that names no key is an issue. The
 * `BINFERENCE_INIT_*` variables answer init and the install script's `BINFERENCE_INSTALL_*` and
 * `BINFERENCE_NODE_MIRROR` set up the program; none is a layer.
 */
export function readEnvLayer(
  root: ConfigNode,
  env: Readonly<Record<string, string | undefined>>,
): EnvLayer {
  const entries: LayerEntry[] = [];
  const issues: ConfigIssue[] = [];
  const names = Object.keys(env).filter(isConfigVariable).toSorted();
  for (const name of names) {
    const text = env[name] ?? "";
    const found = walk(root, name.slice(prefix.length).split("__"));
    const origin = { layer: "env", name } as const;
    if (found.node === undefined) {
      issues.push(configIssue(found.path, { kind: "unknown_key" }, origin));
    } else if (text !== "") {
      entries.push({ path: found.path, value: readLayerText(found.node, text), origin });
    }
  }
  return { entries, issues };
}
