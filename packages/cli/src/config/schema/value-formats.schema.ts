import { isAbsolute } from "node:path";
import { type ChainRef, isChainRef } from "@binference/chain";
import { z } from "zod";

/** A text format a config value must follow, named so an issue can say which one. */
export type ValueFormat =
  | "url"
  | "model"
  | "time_zone"
  | "chain"
  | "decimal"
  | "path"
  | "keychain_name"
  | "env_name";

type PatternFormat = Exclude<ValueFormat, "url" | "chain">;

const patterns: Readonly<Record<PatternFormat, RegExp>> = {
  model: /^[^\s/]+\/\S+$/,
  time_zone: /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/,
  decimal: /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
  path: /^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/,
  keychain_name: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  env_name: /^[A-Za-z_][A-Za-z0-9_]*$/,
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
const dollarText = /^(\d+)(?:\.(\d{1,6}))?$/;

function hasMicroPrecision(dollars: number): boolean {
  return dollarText.test(String(dollars));
}

/**
 * US dollars written as a plain number, such as `100` or `0.25`, read as `bigint` micro-dollars.
 * At most six decimals and at most a trillion dollars.
 */
export const usdSchema: z.ZodCodec<z.ZodNumber, z.ZodBigInt> = z.codec(
  z.number().min(0).max(1e12).refine(hasMicroPrecision, { message: "At most six decimals." }),
  z.bigint(),
  {
    decode: (dollars) => {
      const [, whole = "0", fraction = ""] = dollarText.exec(String(dollars)) ?? [];
      return BigInt(whole) * microsPerDollar + BigInt(fraction.padEnd(6, "0"));
    },
    encode: (micros) => Number(micros) / Number(microsPerDollar),
  },
);
