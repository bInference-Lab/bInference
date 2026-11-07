import type { ResultOf } from "@binference/protocol";
import { type ConfigNode, nodeAt } from "./config-tree.js";
import { describeRule, englishConfigWords } from "./describe-rule.js";

/** One key's rule as `config/view` answers it. */
type ConfigKeyRule = ResultOf<"config/view">["rules"][number];

/** The most rules one read answers, as `config/view` allows. */
const maxRules = 200;

function rulesUnder(node: ConfigNode, path: readonly string[]): readonly ConfigKeyRule[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) => rulesUnder(child, [...path, key]));
  }
  if (node.kind === "map") {
    return rulesUnder(node.value, [...path, `<${node.keyName}>`]);
  }
  const { description = "" } = node.info;
  return [
    { path: path.join("."), description, takes: describeRule(node.rule, englishConfigWords) },
  ];
}

/**
 * The rules of every key at and under a dotted path of the config's shape, in the schema's order:
 * its path, with `<name>` for a key a map lets the owner choose, its description and what it
 * takes, in English, at most 200; `undefined` for a path that leaves the config's shape.
 */
export function configKeyRules(
  root: ConfigNode,
  path: readonly string[],
): readonly ConfigKeyRule[] | undefined {
  const node = nodeAt(root, path);
  return node === undefined ? undefined : rulesUnder(node, path).slice(0, maxRules);
}
