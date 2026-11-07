import { createFormatter, type MessageValues } from "@binference/i18n";
import type { ValueRule } from "./config-tree.js";
import type { ValueFormat } from "./schema/value-formats.schema.js";

/** A message of the `config` area in one language, with its values: `rule.url`. */
export type ConfigWords = (key: string, values?: MessageValues) => string;

const formatKeys: Readonly<Record<ValueFormat, string>> = {
  url: "rule.url",
  https_origin: "rule.httpsOrigin",
  model: "rule.model",
  time_zone: "rule.timeZone",
  chain: "rule.chain",
  decimal: "rule.decimal",
  usd: "rule.usd",
  path: "rule.path",
  keychain_name: "rule.keychainName",
  env_name: "rule.envName",
  credential_name: "rule.credentialName",
};

// The secret source forms are config syntax, the same in every language.
const secretForms = {
  keychain: '{ fromKeychain: "name" }',
  env: '{ fromEnv: "NAME" }',
  file: '{ fromFile: "path" }',
  command: '{ fromCommand: ["program", "argument"] }',
  credential: '{ fromCredential: "NAME" }',
};

const plainKeys: Readonly<Record<"boolean" | "object" | "json", string>> = {
  boolean: "rule.boolean",
  object: "rule.object",
  json: "rule.json",
};

type NumberRule = Extract<ValueRule, { readonly kind: "integer" | "number" }>;

function numberText(rule: NumberRule, words: ConfigWords): string {
  if (rule.min !== undefined && rule.max !== undefined) {
    return words("rule.numberRange", { min: String(rule.min), max: String(rule.max) });
  }
  const atLeast = rule.kind === "integer" ? "rule.integerAtLeast" : "rule.numberAtLeast";
  return rule.min === undefined
    ? words(`rule.${rule.kind}`)
    : words(atLeast, { min: String(rule.min) });
}

function choiceOf(allowed: readonly (string | number | boolean)[], words: ConfigWords): string {
  const quoted = allowed.map((item) => JSON.stringify(item));
  return quoted.length === 1
    ? (quoted[0] ?? "")
    : words("rule.oneOf", { choices: quoted.join(", ") });
}

function secretOf(
  rule: Extract<ValueRule, { readonly kind: "secret" }>,
  words: ConfigWords,
): string {
  return rule.commandOnly
    ? words("rule.commandSecret", { command: secretForms.command })
    : words("rule.secret", secretForms);
}

function eitherOf(options: readonly ValueRule[], words: ConfigWords): string {
  const [first, ...rest] = options.map((option) => describeRule(option, words));
  return rest.reduce(
    (text, next) => words("rule.either", { first: text, second: next }),
    first ?? "",
  );
}

/**
 * What a key takes, in the language of `words`: `a number from 1024 to 65535`,
 * `one of "en", "zh"`. Config issues write it in English; the docs reference in each language.
 */
export function describeRule(rule: ValueRule, words: ConfigWords): string {
  if (rule.kind === "integer" || rule.kind === "number") {
    return numberText(rule, words);
  }
  if (rule.kind === "text") {
    return words(rule.format === undefined ? "rule.text" : formatKeys[rule.format]);
  }
  if (rule.kind === "choice") {
    return choiceOf(rule.allowed, words);
  }
  if (rule.kind === "list") {
    return words("rule.list", { item: describeRule(rule.item, words) });
  }
  if (rule.kind === "secret") {
    return secretOf(rule, words);
  }
  if (rule.kind === "either") {
    return eitherOf(rule.options, words);
  }
  return words(plainKeys[rule.kind]);
}

const english = createFormatter({ locale: "en", timeZone: "UTC" });

/** {@link ConfigWords} in English, for config issues in logs and developer messages. */
export const englishConfigWords: ConfigWords = (key, values) =>
  english.message(`config.${key}`, values);
