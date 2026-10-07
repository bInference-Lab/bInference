import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { nonceSchema } from "./transaction-record.js";

/** What the wallet queue asks the store for: the account's next nonce, given the chain's count. */
export interface NonceRequest {
  readonly account: AccountRef;
  /** The next nonce the chain expects from the account, read right before the request. */
  readonly chainNonce: number;
  readonly atMs: number;
}

/** Parses a nonce request. */
export const nonceRequestSchema: z.ZodType<NonceRequest> = z.strictObject({
  account: accountRefSchema,
  chainNonce: nonceSchema,
  atMs: epochMsSchema,
});

/** The nonce the wallet queue gives a step, and whether it fills a gap the account left. */
export interface NonceGrant {
  readonly nonce: number;
  /**
   * The queue gave this nonce or a later one before, and no transaction holds this one now: its
   * step was never signed, or its transaction was dropped. The step that takes it fills the gap.
   */
  readonly refillsGap: boolean;
}

/** Parses a nonce grant. */
export const nonceGrantSchema: z.ZodType<NonceGrant> = z.strictObject({
  nonce: nonceSchema,
  refillsGap: z.boolean(),
});
