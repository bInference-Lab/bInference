import { describe, expect, it } from "vitest";
import type { ConfigIssue, ConfigOrigin } from "./config-issue.js";
import { configTree } from "./config-json-schema.js";
import type { ConfigNode, ValueRule } from "./config-tree.js";
import { formatConfigIssue } from "./format-config-issue.js";
import type { JsonObject, JsonValue } from "./json-value.schema.js";
import { mergeLayers } from "./layers/merge-layers.js";
import { applyEdits } from "./migrations/config-edit.js";
import type { BinferenceConfig } from "./schema/config.schema.js";
import { type ConfigOutcome, validateConfig } from "./validate-config.js";

const fileOrigin: ConfigOrigin = { layer: "file", name: "/srv/binference/config.json5" };
const base: JsonObject = { telegram: { botToken: { fromKeychain: "telegram-bot" } } };

function check(value: JsonObject, origin: ConfigOrigin = fileOrigin): ConfigOutcome {
  return validateConfig(mergeLayers(configTree, [{ path: [], value, origin }]));
}

function issuesOf(outcome: ConfigOutcome): readonly ConfigIssue[] {
  return outcome.ok ? [] : outcome.issues;
}

function lines(value: JsonObject, origin?: ConfigOrigin): readonly string[] {
  return issuesOf(check(value, origin)).map(formatConfigIssue);
}

function configOf(outcome: ConfigOutcome): BinferenceConfig {
  if (!outcome.ok) {
    throw new Error(outcome.issues.map(formatConfigIssue).join("\n"));
  }
  return outcome.config;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Keys without a description; a map's own key and a free JSON value need none.
function undescribed(node: ConfigNode, path: string): readonly string[] {
  const own = node.info.description === undefined && !path.endsWith(">") ? [path] : [];
  if (node.kind === "group") {
    const inner = [...node.keys].flatMap(([key, child]) => undescribed(child, `${path}.${key}`));
    return [...own, ...inner];
  }
  if (node.kind === "map") {
    return [...own, ...undescribed(node.value, `${path}.<${node.keyName}>`)];
  }
  return node.rule.kind === "json" ? [] : own;
}

// Every key named dangerously..., with its default: a risky switch must default to off.
function dangerousKeys(
  node: ConfigNode,
  path: string,
): readonly (readonly [string, JsonValue | undefined])[] {
  const own =
    path.split(".").at(-1)?.startsWith("dangerously") === true
      ? [[path, node.info.defaultValue] as const]
      : [];
  if (node.kind === "group") {
    return [
      ...own,
      ...[...node.keys].flatMap(([key, child]) => dangerousKeys(child, `${path}.${key}`)),
    ];
  }
  return node.kind === "map" ? [...own, ...dangerousKeys(node.value, `${path}.<key>`)] : own;
}

// A value of the wrong kind for each kind of key.
const wrongValues: Readonly<Record<ValueRule["kind"], JsonValue>> = {
  integer: "abc",
  number: "abc",
  boolean: "abc",
  object: "abc",
  text: 12_345,
  choice: 12_345,
  secret: 12_345,
  either: [],
  list: "not a list",
  json: null,
};

function keyFor(rule: ValueRule): string {
  return rule.kind === "text" && rule.format === "chain" ? "eip155:56" : "a/b";
}

interface Leaf {
  readonly path: readonly string[];
  readonly rule: ValueRule;
}

// Every value key of the config, with a valid key for each map on the way.
function leaves(node: ConfigNode, path: readonly string[]): readonly Leaf[] {
  if (node.kind === "group") {
    return [...node.keys].flatMap(([key, child]) => leaves(child, [...path, key]));
  }
  if (node.kind === "map") {
    return leaves(node.value, [...path, keyFor(node.keyRule)]);
  }
  return node.rule.kind === "json" ? [] : [{ path, rule: node.rule }];
}

describe("validate config", () => {
  it("writes the spec's example message for a port that is not a number", () => {
    expect(lines({ ...base, engine: { port: "abc" } })).toStrictEqual([
      'engine.port: must be a number from 1024 to 65535 (got "abc"). Set it in config.json5 or remove it.',
    ]);
  });

  it.each(leaves(configTree, []))("names the path and fix of a bad $path", ({ path, rule }) => {
    const issues = issuesOf(
      check(applyEdits(base, [{ kind: "set", path, value: wrongValues[rule.kind] }])),
    );
    const own = issues.filter((issue) => issue.path === path.join("."));
    // Keys that must sit beside this one, such as a provider's kind, are reported as required.
    const others = issues.filter((issue) => issue.path !== path.join("."));
    expect(own.map(formatConfigIssue)).toStrictEqual([
      expect.stringMatching(new RegExp(`^${escaped(path.join("."))}: .+\\. [A-Z].+\\.$`)),
    ]);
    expect(others.map((issue) => issue.problem.kind)).not.toContain("bad_value");
  });

  it("names every unknown key and how to remove it", () => {
    expect(lines({ ...base, engine: { prot: 1 }, extras: true })).toStrictEqual([
      "engine.prot: is not a config key. Remove it from config.json5, or check its spelling.",
      "extras: is not a config key. Remove it from config.json5, or check its spelling.",
    ]);
  });

  it("refuses a secret written as plain text without showing it", () => {
    const outcome = check({ telegram: { botToken: "7012345678:AAH-plain-token-in-the-file" } });
    expect(outcome).toMatchObject({ ok: false, issues: [{ problem: { kind: "secret_inline" } }] });
    expect(JSON.stringify(outcome)).not.toContain("AAH-plain");
    expect(lines({ telegram: { botToken: "hunter2" } })).toStrictEqual([
      "telegram.botToken: holds a secret as plain text. Run binference check --fix to move it to " +
        'the keychain, or write a secret source such as { fromKeychain: "name" } instead.',
    ]);
  });

  it("names the forms of a secret source that has none of them", () => {
    expect(lines({ telegram: { botToken: { fromVault: "bot" } } })[0]).toBe(
      'telegram.botToken: must be a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, ' +
        '{ fromFile: "path" } or { fromCommand: ["program", "argument"] }. Set it in config.json5 or remove it.',
    );
    expect(lines({ telegram: { botToken: { fromEnv: "1BAD", fromFile: "/x" } } })).toHaveLength(1);
  });

  it("names a bad map key, a bad list item and a bad choice", () => {
    expect(
      lines({
        ...base,
        chains: { rpc: { bsc: {} } },
        engine: { extraOrigins: ["https://ok.example", "nope"] },
        owner: { locale: "fr" },
      }),
    ).toStrictEqual([
      'owner.locale: must be one of "en", "zh" (got "fr"). Set it in config.json5 or remove it.',
      'engine.extraOrigins: must be a list in which each item is a URL (got "nope"). Set it in config.json5 or remove it.',
      "chains.rpc.bsc: is not a valid key here; a key must be a chain id such as eip155:56. Set it in config.json5 or remove it.",
    ]);
  });

  it("names the variable or the flag that set a bad value", () => {
    expect(
      lines({ ...base, engine: { port: 1 } }, { layer: "env", name: "BINFERENCE_ENGINE__PORT" }),
    ).toStrictEqual([
      "engine.port (BINFERENCE_ENGINE__PORT): must be a number from 1024 to 65535 (got 1). Set " +
        "BINFERENCE_ENGINE__PORT to a valid value or unset it.",
    ]);
    expect(
      lines({ ...base, engine: { port: 1 } }, { layer: "flag", name: "engine.port" }),
    ).toStrictEqual([
      "engine.port: must be a number from 1024 to 65535 (got 1). Change the --set engine.port= flag or leave it out.",
    ]);
  });

  it("refuses dollars with more than six decimals and reads others as micro-dollars", () => {
    expect(lines({ ...base, defaults: { limits: { perTradeUsd: 0.000_000_1 } } })).toHaveLength(1);
    const config = configOf(check({ ...base, defaults: { limits: { perTradeUsd: 12.345_678 } } }));
    expect(config.defaults.limits.perTradeUsd).toBe(12_345_678n);
  });

  it("defaults every dangerously switch to false", () => {
    const risky = dangerousKeys(configTree, "config");
    expect(risky.filter(([, value]) => value !== false)).toStrictEqual([]);
  });

  it("describes every key, so the reference and the console forms have words for it", () => {
    expect(undescribed(configTree, "config")).toStrictEqual([]);
  });
});
