import { isAbsolute } from "node:path";
import { type ChainRef, isChainRef } from "@binference/chain";
import { z } from "zod";

/** A text format a config value must follow, named so an issue can say which one. */
export type ValueFormat =
  | "url"
  | "https_origin"
  | "model"
  | "time_zone"
  | "chain"
  | "decimal"
  | "usd"
  | "path"
  | "keychain_name"
  | "env_name";

type PatternFormat = Exclude<ValueFormat, "url" | "chain">;

const patterns: Readonly<Record<PatternFormat, RegExp>> = {
  model: /^[^\s/]+\/\S+$/,
  time_zone: /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/,
  decimal: /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
  usd: /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/,
  path: /^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/,
  keychain_name: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  env_name: /^[A-Za-z_][A-Za-z0-9_]*$/,
  https_origin: /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?\/?$/,
};

/**
 * Text in one of the named formats. The JSON Schema carries the format's name as `valueFormat`,
 * so an issue and the generated docs name the format instead of a pattern.
 */
export function formatted(format: PatternFormat): z.ZodString {
  return z.string().regex(patterns[format]).meta({ valueFormat: format });
}

/** A model as `<provider>/<model>`, such as `binference/main-default`. */
export const modelSchema: z.ZodString = formatted("model");

/** A chain as its CAIP-2 id, such as `eip155:56`. */
export const chainSchema: z.ZodType<ChainRef, string> = z
  .string()
  .refine(isChainRef)
  .meta({ valueFormat: "chain" });

/** An absolute path, or one that starts at the home folder with `~/`. */
export const pathSchema: z.ZodType<string, string> = formatted("path").refine(
  (text) => text.startsWith("~") || isAbsolute(text),
);

/** An amount of a coin as a decimal string, such as `"0.002"`, kept as text until its decimals are known. */
export const decimalSchema: z.ZodString = formatted("decimal");

/** A TCP port binference listens on. */
export const portSchema: z.ZodInt = z.int().min(1024).max(65_535);

const microsPerDollar = 1_000_000n;
const microDigits = 6;

// Micro-dollars as the shortest decimal text that reads back as them, such as "0.25".
function dollarsOf(micros: bigint): string {
  const whole = micros / microsPerDollar;
  const fraction = (micros % microsPerDollar).toString().padStart(microDigits, "0");
  const kept = fraction.replace(/0+$/, "");
  return kept === "" ? String(whole) : `${String(whole)}.${kept}`;
}

/**
 * US dollars written as a decimal string, such as `"100"` or `"0.25"`, read as `bigint`
 * micro-dollars without passing through a `number`. At most six decimals and less than a
 * trillion dollars.
 */
export const usdSchema: z.ZodCodec<z.ZodString, z.ZodBigInt> = z.codec(
  formatted("usd"),
  z.bigint().nonnegative(),
  {
    decode: (dollars) => {
      const [whole = "0", fraction = ""] = dollars.split(".");
      return BigInt(whole) * microsPerDollar + BigInt(fraction.padEnd(microDigits, "0"));
    },
    encode: dollarsOf,
  },
);
