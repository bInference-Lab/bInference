import { redactSecrets } from "@binference/core";
import type { z } from "zod";
import {
  type ConfigIssue,
  configIssue,
  type ConfigOrigin,
  type ConfigProblem,
} from "./config-issue.js";
import { configTree } from "./config-json-schema.js";
import { childOf, type ConfigNode, nodeAt } from "./config-tree.js";
import { isJsonObject, type JsonValue, jsonValueSchema } from "./json-value.schema.js";
import { type MergedLayers, originOf } from "./layers/merge-layers.js";
import { type BinferenceConfig, configSchema, requiredParams } from "./schema/config.schema.js";

/** A config that passed validation. */
export interface ValidConfig {
  readonly ok: true;
  readonly config: BinferenceConfig;
  /** The layer of each key a layer set, by dotted path; every other key has its default. */
  readonly origins: ReadonlyMap<string, ConfigOrigin>;
}

/** A config that failed: every issue, each with its path and its fix. */
export interface InvalidConfig {
  readonly ok: false;
  readonly issues: readonly ConfigIssue[];
}

/** The outcome of reading or validating the config. */
export type ConfigOutcome = ValidConfig | InvalidConfig;

const previewLength = 40;

/** How an issue shows a value it got: short, redacted, and never a list's or object's content. */
export function previewOf(value: JsonValue): string {
  if (Array.isArray(value)) {
    return "a list";
  }
  if (isJsonObject(value)) {
    return "an object";
  }
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }
  const masked = redactSecrets(value);
  return JSON.stringify(
    masked.length > previewLength ? `${masked.slice(0, previewLength - 1)}…` : masked,
  );
}

interface Owner {
  readonly node: ConfigNode;
  readonly path: readonly string[];
}

// The deepest config node on the path, and how much of the path leads to it: an issue inside a
// value, such as a list item or a secret source's field, belongs to the value.
function ownerOf(path: readonly string[]): Owner {
  let node = configTree;
  for (const [index, key] of path.entries()) {
    const child = node.kind === "value" ? undefined : childOf(node, key);
    if (child === undefined) {
      return { node, path: path.slice(0, index) };
    }
    node = child;
  }
  return { node, path };
}

function requiredLeaves(node: ConfigNode, path: readonly string[]): readonly (readonly string[])[] {
  if (node.kind !== "group" || node.required.size === 0) {
    return [path];
  }
  return [...node.required].flatMap((key) => {
    const child = node.keys.get(key);
    return child === undefined ? [[...path, key]] : requiredLeaves(child, [...path, key]);
  });
}

function valueProblem(
  owner: Owner,
  issuePath: readonly string[],
  input: JsonValue | undefined,
): ConfigProblem {
  const rule = owner.node.kind === "value" ? owner.node.rule : { kind: "object" as const };
  if (rule.kind !== "secret") {
    return { kind: "bad_value", rule, got: input === undefined ? "" : previewOf(input) };
  }
  // A scalar where a secret source belongs is the secret itself; a source's own fields are not.
  const isSource = owner.path.length < issuePath.length;
  const isPlain = !isSource && input !== undefined && input !== null && typeof input !== "object";
  return isPlain ? { kind: "secret_inline" } : { kind: "bad_value", rule, got: "" };
}

/** A problem at a path, before it gets its origin. */
interface Found {
  readonly path: readonly string[];
  readonly problem: ConfigProblem;
}

function isRequiredIssue(issue: z.core.$ZodIssue): boolean {
  if (issue.code === "custom") {
    return issue.params?.["problem"] === requiredParams.problem;
  }
  return issue.input === undefined;
}

function problemsOf(issue: z.core.$ZodIssue): readonly Found[] {
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({ path: [...path, key], problem: { kind: "unknown_key" } }));
  }
  if (issue.code === "invalid_key") {
    const map = nodeAt(configTree, path.slice(0, -1));
    const rule = map?.kind === "map" ? map.keyRule : { kind: "text" as const };
    return [{ path, problem: { kind: "bad_key", rule } }];
  }
  const owner = ownerOf(path);
  if (isRequiredIssue(issue)) {
    return requiredLeaves(owner.node, path).map((leaf) => ({
      path: leaf,
      problem: { kind: "required" },
    }));
  }
  const parsed = jsonValueSchema.safeParse(issue.input);
  const input = parsed.success ? parsed.data : undefined;
  return [{ path: owner.path, problem: valueProblem(owner, path, input) }];
}

// Keeps the first problem of each key: a union or a list can report one key many times.
function firstPerKey(found: readonly Found[]): readonly Found[] {
  const byKey = new Map<string, Found>();
  for (const item of found) {
    const key = item.path.join(".");
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

/**
 * Validates the merged layers against the one strict schema. Each issue names its key's path,
 * what is wrong, the fix and the layer the value came from; one issue per key.
 */
export function validateConfig(merged: MergedLayers): ConfigOutcome {
  const parsed = configSchema.safeParse(merged.value, { reportInput: true });
  if (parsed.success) {
    return { ok: true, config: parsed.data, origins: merged.origins };
  }
  const issues = firstPerKey(parsed.error.issues.flatMap(problemsOf)).map(({ path, problem }) =>
    configIssue(path, problem, originOf(merged.origins, path)),
  );
  return { ok: false, issues };
}
