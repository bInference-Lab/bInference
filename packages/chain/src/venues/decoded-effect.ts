import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";

/**
 * What a venue's trade call does, read back from its bytes by the venue's decoder. The venue host
 * checks each field against the trade it asked for.
 */
export interface DecodedEffect {
  /** The account the call pays its output to. */
  readonly recipient: AccountRef;
  /** What the call spends: the asset and its exact base units. */
  readonly amountIn: Amount;
  /** The asset the call buys and the least it accepts, in base units. */
  readonly minOut: Amount;
  /**
   * Epoch milliseconds after which the call reverts. Absent when the call carries no deadline, as
   * a launchpad's curve call may not: the host accepts that only from a venue that declares its
   * trade calls on the chain as having none (`noDeadline` in its declaration).
   */
  readonly deadlineMs?: number;
}

/** A {@link DecodedEffect} as JSON carries it. */
export interface DecodedEffectWire {
  readonly recipient: string;
  readonly amountIn: AmountWire;
  readonly minOut: AmountWire;
  readonly deadlineMs?: number;
}

/** Decodes a decoded effect from JSON, and encodes it back with `z.encode`. */
export const decodedEffectSchema: z.ZodType<DecodedEffect, DecodedEffectWire> = z.strictObject({
  recipient: accountRefSchema,
  amountIn: amountSchema,
  minOut: amountSchema,
  deadlineMs: z.int().nonnegative().exactOptional(),
});
