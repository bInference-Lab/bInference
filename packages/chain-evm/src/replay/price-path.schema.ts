import { decimalStringSchema } from "@binference/core";
import { getAddress } from "viem";
import { z } from "zod";
import type { PricePath } from "./price-path.js";

const addressSchema = z.string().transform((value, context) => {
  try {
    return getAddress(value);
  } catch {
    context.addIssue({ code: "custom", message: "Not an EVM address." });
    return z.NEVER;
  }
});
const decimalsSchema = z.int().min(0).max(36);
const priceSchema = z.string().regex(/^\d+\.\d{18}$/);

const blockSchema = z
  .tuple([decimalStringSchema, decimalStringSchema, decimalStringSchema, priceSchema])
  .transform(([offset, reserveToken, reserveQuote, price]) => ({
    offset,
    reserveToken,
    reserveQuote,
    price,
  }));

const poolSchema = z.strictObject({
  symbol: z.string().min(1),
  token: addressSchema,
  quote: addressSchema,
  pair: addressSchema,
  tokenDecimals: decimalsSchema,
  quoteDecimals: decimalsSchema,
  blocks: z.array(blockSchema).min(1),
});

const pathSchema = z.strictObject({
  day: z.iso.date(),
  firstBlock: decimalStringSchema,
  lastBlock: decimalStringSchema,
  minMoveBps: z.int().min(0).max(10_000),
  pools: z.array(poolSchema).min(1),
});

/** Reads a recorded day from its JSON file, parsed; throws on a file that does not match. */
export function readPricePath(file: unknown): PricePath {
  return pathSchema.parse(file);
}
