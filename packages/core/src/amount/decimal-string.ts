import { z } from "zod";

const digits = /^(?:0|[1-9]\d{0,77})$/;

/**
 * Parses a decimal string of an unsigned integer, such as `"1500000000000000000"`, into a bigint,
 * and encodes it back. Money and micro-dollars cross JSON this way, never as a number. Leading
 * zeros, signs and anything above 78 digits are refused.
 */
export const decimalStringSchema: z.ZodCodec<z.ZodString, z.ZodBigInt> = z.codec(
  z.string().regex(digits, { message: "Expected a decimal string of an unsigned integer." }),
  z.bigint().nonnegative(),
  { decode: (text) => BigInt(text), encode: (value) => value.toString() },
);
