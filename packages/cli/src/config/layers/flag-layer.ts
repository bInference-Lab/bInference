import { type ConfigIssue, configIssue } from "../config-issue.js";
import { type ConfigNode, nodeAt } from "../config-tree.js";
import { type LayerEntry, readLayerText } from "./layer-entry.js";

/** What the flag layer found: its entries, and the flags it could not read. */
export interface FlagLayer {
  readonly entries: readonly LayerEntry[];
  readonly issues: readonly ConfigIssue[];
}

/**
 * Reads each `--set key=value` flag as a layer, in order, so a later flag wins. The key is the
 * path as the file writes it (`engine.port`); the value is read as {@link readLayerText} reads it.
 * An origin names the flag by its key, or by its place (`#2`) when it has none, never its value.
 */
export function readFlagLayer(root: ConfigNode, sets: readonly string[]): FlagLayer {
  const entries: LayerEntry[] = [];
  const issues: ConfigIssue[] = [];
  for (const [index, set] of sets.entries()) {
    const split = set.indexOf("=");
    const path = split <= 0 ? [] : set.slice(0, split).split(".");
    // The flag's value may be a secret typed by mistake, so an origin names only its key.
    const name = split <= 0 ? `#${String(index + 1)}` : set.slice(0, split);
    const origin = { layer: "flag", name } as const;
    const node = nodeAt(root, path);
    if (path.length === 0 || path.includes("")) {
      issues.push(configIssue([], { kind: "bad_flag" }, origin));
    } else if (node === undefined) {
      issues.push(configIssue(path, { kind: "unknown_key" }, origin));
    } else {
      entries.push({ path, value: readLayerText(node, set.slice(split + 1)), origin });
    }
  }
  return { entries, issues };
}
