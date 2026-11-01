import { decimalStringSchema } from "@binference/plugin-sdk";
import { parseJsonText } from "@binference/plugin-sdk/data";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { evmAddressTextSchema, word32TextSchema } from "../wire-values.schema.js";

/**
 * A quote's record for the build: what it was asked (the wallet, the token and amount that leave,
 * the recipient, the token that arrives and its chain), so a build for another request is refused,
 * and what only Relay sets: the order the deposit pays and its least output.
 */
export interface QuoteRecord {
  readonly depositor: Address;
  readonly tokenIn: Address;
  readonly amount: bigint;
  readonly recipient: string;
  readonly currencyOut: string;
  /** The destination chain, by the name a Relay order gives it. */
  readonly destination: string;
  readonly orderId: Hex;
  readonly minimumAmount: bigint;
}

const recordSchema = z.strictObject({
  depositor: evmAddressTextSchema,
  tokenIn: evmAddressTextSchema,
  amount: decimalStringSchema,
  recipient: z.string().min(32).max(44),
  currencyOut: z.string().min(32).max(44),
  destination: z.string().regex(/^[a-z0-9-]{1,64}$/),
  orderId: word32TextSchema,
  minimumAmount: decimalStringSchema,
});

/** The record as the quote carries it. */
export function writeQuoteRecord(record: QuoteRecord): string {
  return JSON.stringify({
    ...record,
    amount: record.amount.toString(),
    minimumAmount: record.minimumAmount.toString(),
  });
}

/** Reads a quote's record back, or `undefined` for a quote without one or another text. */
export function readQuoteRecord(text: string | undefined): QuoteRecord | undefined {
  const parsed = recordSchema.safeParse(text === undefined ? undefined : parseJsonText(text));
  return parsed.success ? parsed.data : undefined;
}
