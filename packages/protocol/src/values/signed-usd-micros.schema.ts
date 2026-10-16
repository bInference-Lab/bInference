import { z } from "zod";

const signedDigits = /^(?:0|-?[1-9]\d{0,77})$/;

// A decimal string with an optional minus into a bigint, and back; zero is "0", never "-0".
function signedCodec(): z.ZodCodec<z.ZodString, z.ZodBigInt> {
  return z.codec(
    z.string().regex(signedDigits, { message: "Expected a decimal string of an integer." }),
    z.bigint(),
    { decode: (text) => BigInt(text), encode: (value) => value.toString() },
  );
}

/**
 * Parses an integer that can fall below zero, such as a gain or a loss in basis points: `"-1500"`
 * into a bigint, and encodes it back. Zero is `"0"`, never `"-0"`.
 */
export const signedIntegerSchema: z.ZodCodec<z.ZodString, z.ZodBigInt> = signedCodec();

/**
 * Parses a micro-dollar value that can fall below zero, such as a profit or a loss: a decimal
 * string with an optional minus, `"-1500000"` for -$1.50, into a bigint, and encodes it back. Zero
 * is `"0"`, never `"-0"`.
 */
export const signedUsdMicrosSchema: z.ZodCodec<z.ZodString, z.ZodBigInt> = signedCodec();
