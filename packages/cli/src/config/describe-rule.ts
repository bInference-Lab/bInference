import type { ValueRule } from "./config-tree.js";
import type { ValueFormat } from "./schema/value-formats.schema.js";

const formatText: Readonly<Record<ValueFormat, string>> = {
  url: "a URL",
  model: "a model written as provider/model",
  time_zone: "an IANA time zone such as Asia/Shanghai",
  chain: "a chain id such as eip155:56",
  decimal: 'a decimal number in quotes, such as "0.002"',
  path: "an absolute path, or one that starts with ~/",
  keychain_name: "a keychain entry name of letters, digits, dots, dashes and underscores",
  env_name: "an environment variable name",
};

const secretForms =
  'a secret source: { fromKeychain: "name" }, { fromEnv: "NAME" }, { fromFile: "path" } or ' +
  '{ fromCommand: ["program", "argument"] }';

function numberText(rule: { readonly min?: number; readonly max?: number }, kind: string): string {
  if (rule.min !== undefined && rule.max !== undefined) {
    return `a number from ${String(rule.min)} to ${String(rule.max)}`;
  }
  return rule.min === undefined ? kind : `${kind} of at least ${String(rule.min)}`;
}

const plainText: Readonly<Record<"boolean" | "object" | "json", string>> = {
  boolean: "true or false",
  object: "an object",
  json: "any JSON value",
};

function textOf(format: ValueFormat | undefined): string {
  return format === undefined ? "text" : formatText[format];
}

function choiceOf(allowed: readonly (string | number | boolean)[]): string {
  const quoted = allowed.map((item) => JSON.stringify(item));
  return quoted.length === 1 ? (quoted[0] ?? "") : `one of ${quoted.join(", ")}`;
}

function secretOf(rule: Extract<ValueRule, { readonly kind: "secret" }>): string {
  return rule.commandOnly
    ? 'a secret source { fromCommand: ["program", "argument"] }'
    : secretForms;
}

/**
 * What a key takes, in English, for developer messages and the generated reference: `a number
 * from 1024 to 65535`, `one of "en", "zh"`.
 */
export function describeRule(rule: ValueRule): string {
  if (rule.kind === "integer") {
    return numberText(rule, "a whole number");
  }
  if (rule.kind === "number") {
    return numberText(rule, "a number");
  }
  if (rule.kind === "text") {
    return textOf(rule.format);
  }
  if (rule.kind === "choice") {
    return choiceOf(rule.allowed);
  }
  if (rule.kind === "list") {
    return `a list in which each item is ${describeRule(rule.item)}`;
  }
  if (rule.kind === "secret") {
    return secretOf(rule);
  }
  if (rule.kind === "either") {
    return rule.options.map(describeRule).join(" or ");
  }
  return plainText[rule.kind];
}
