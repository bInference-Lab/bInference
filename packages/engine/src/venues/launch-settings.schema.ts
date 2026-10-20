import {
  type LaunchOption,
  type LaunchOptionType,
  type LaunchOptionValue,
  printAccountRef,
  type RegisteredChain,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { messageLocales, messages } from "@binference/i18n";
import type { LaunchTokenRequest } from "@binference/protocol";
import { z } from "zod";

/**
 * One launchpad setting of a launch with its value, as the launch quote keeps it and the card
 * shows it: an account as its canonical account id on the launch's chain.
 */
export interface LaunchSetting {
  readonly name: string;
  readonly type: LaunchOptionType;
  readonly value: LaunchOptionValue;
}

// The largest whole number a JSON number holds exactly, which bounds a `count`.
const largestCount = 9_007_199_254_740_991;

// An address the chain's family reads, as its canonical account id on the chain.
function accountOf(chain: RegisteredChain, text: string): string | undefined {
  const address = chain.family.parseAddress(text);
  const account = address.ok
    ? printAccountRef({ chain: chain.ref, address: address.value })
    : undefined;
  return account?.ok === true ? account.value : undefined;
}

// A picture link the owner hosts (decision 0276): IPFS or HTTPS, at most 512 bytes, and nothing
// after the scheme a card could hide or that is not text: no space or separator of any kind, no
// control or format character, and no lone surrogate. Nothing opens it.
const linkMostBytes = 512;
const linkPattern = /^(?:ipfs|https):\/\/[^\s\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u;

function isPictureLink(text: string): boolean {
  return linkPattern.test(text) && new TextEncoder().encode(text).byteLength <= linkMostBytes;
}

type ValueSchemaOf = (option: LaunchOption, chain: RegisteredChain) => z.ZodType<LaunchOptionValue>;

// The schema a declared setting's value passes, by its type and bounds (decision 0235).
const valueSchemas: { readonly [T in LaunchOptionType]: ValueSchemaOf } = {
  bps: (option) =>
    z
      .int()
      .min(option.min ?? 0)
      .max(option.max ?? 10_000),
  count: (option) =>
    z
      .int()
      .min(option.min ?? 0)
      .max(option.max ?? largestCount),
  flag: () => z.boolean(),
  choice: (option) => {
    const choices = new Set(option.choices);
    return z.string().refine((value) => choices.has(value));
  },
  account: (_option, chain) =>
    z
      .string()
      .refine((text) => accountOf(chain, text) !== undefined)
      .transform((text) => accountOf(chain, text) ?? text),
  link: () => z.string().refine(isPictureLink),
  // Base units of the launch's pair, above 0, as a decimal string (decision 0280).
  amount: () => z.string().regex(/^[1-9][0-9]{0,77}$/),
};

function valueSchema(option: LaunchOption, chain: RegisteredChain): z.ZodType<LaunchOptionValue> {
  return valueSchemas[option.type](option, chain);
}

// A declared setting's schema in a request: one with a default takes it, parsed like a given
// value, and an optional one may be left out (decision 0280).
function requestSchemaOf(option: LaunchOption, chain: RegisteredChain) {
  const schema = valueSchema(option, chain);
  if (option.default !== undefined) {
    return schema.prefault(option.default);
  }
  return option.isOptional === true ? schema.optional() : schema;
}

// Each declared setting by name.
function settingsSchema(options: readonly LaunchOption[], chain: RegisteredChain) {
  const shape = Object.fromEntries(
    options.map((option) => [option.name, requestSchemaOf(option, chain)]),
  );
  return z.strictObject(shape);
}

/**
 * A value a launchpad worked out at its quote for one of its optional settings (decision 0280),
 * checked as a request's value would be: an account in its canonical form. A value that does not
 * fit its setting, or a setting that is not optional, is `undefined`.
 */
export function quotedSettingOf(
  option: LaunchOption,
  value: LaunchOptionValue,
  chain: RegisteredChain,
): LaunchSetting | undefined {
  const parsed = valueSchema(option, chain).safeParse(value);
  return option.isOptional === true && parsed.success
    ? { name: option.name, type: option.type, value: parsed.data }
    : undefined;
}

/**
 * A launch's launchpad settings from a request's `venueOptions` (decision 0235), checked by the
 * schema the launchpad's declaration makes: every setting it declares, in its order, with the
 * request's value or else its default, an optional one left out when the request leaves it out. A
 * name the launchpad does not declare, a value outside its type or bounds, or a setting that is
 * neither optional nor has a default the request leaves out is `bad_settings`.
 */
export function launchSettingsOf(
  options: readonly LaunchOption[],
  given: LaunchTokenRequest["venueOptions"],
  chain: RegisteredChain,
): Result<readonly LaunchSetting[], "bad_settings"> {
  const parsed = settingsSchema(options, chain).safeParse(given ?? {});
  if (!parsed.success) {
    return err("bad_settings");
  }
  const values: Readonly<Record<string, LaunchOptionValue | undefined>> = parsed.data;
  return ok(
    options.flatMap((option) => {
      const value = values[option.name];
      return value === undefined ? [] : [{ name: option.name, type: option.type, value }];
    }),
  );
}

/** The message key of a launchpad setting's card line (spec 4, section 3.3). */
export function launchSettingKey(name: string): `launch.option.${string}` {
  return `launch.option.${name}`;
}

/** The message key of a launchpad's card warning (decision 0281). */
export function launchWarningKey(name: string): `launch.warn.${string}` {
  return `launch.warn.${name}`;
}

/** Why a launchpad's card warnings cannot be hosted: one with no message in every language. */
export function launchWarningsProblem(names: readonly string[]): string | undefined {
  const unnamed = names.find((name) =>
    messageLocales.some((locale) => messages[locale][launchWarningKey(name)] === undefined),
  );
  return unnamed === undefined
    ? undefined
    : `its card warning ${unnamed} has no message ${launchWarningKey(unnamed)} in every language.`;
}

/**
 * Why a launchpad's settings cannot be hosted, or `undefined` when they can: a setting with no
 * card line in every language, or a default that does not fit its setting.
 */
export function launchSettingsProblem(
  options: readonly LaunchOption[],
  chain: RegisteredChain,
): string | undefined {
  const unnamed = options.find((option) =>
    messageLocales.some((locale) => messages[locale][launchSettingKey(option.name)] === undefined),
  );
  if (unnamed !== undefined) {
    return `its setting ${unnamed.name} has no message ${launchSettingKey(unnamed.name)} in every language.`;
  }
  const misfit = options.find(
    (option) =>
      option.default !== undefined && !valueSchema(option, chain).safeParse(option.default).success,
  );
  return misfit === undefined
    ? undefined
    : `the default of its setting ${misfit.name} does not fit the setting.`;
}
