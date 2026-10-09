import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import type { PendingRescue, RescueState } from "../policy/rescue-change.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type SignedCeilingChange, signedCeilingChangeSchema } from "./ceiling-change.js";

/** Parses a new rescue address that waits for its time. */
export const pendingRescueSchema: z.ZodType<PendingRescue> = z.strictObject({
  address: accountRefSchema,
  atMs: epochMsSchema,
});

/** Parses the install's rescue address and the new one that waits. */
const rescueStateSchema: z.ZodType<RescueState> = z.strictObject({
  rescueAddress: accountRefSchema.exactOptional(),
  pendingRescue: pendingRescueSchema.exactOptional(),
});

/**
 * The ceiling changes the owner key signed ahead for a new rescue address that waits (decision
 * 0110): one that leaves the old address out once the new one takes effect, and one that leaves
 * the new address out if the owner cancels. A change is absent when there is nothing to send.
 */
export interface RescueCeiling {
  readonly onEffect?: SignedCeilingChange;
  readonly onCancel?: SignedCeilingChange;
}

/** Parses the ceiling changes kept for a new rescue address. */
export const rescueCeilingSchema: z.ZodType<RescueCeiling> = z.strictObject({
  onEffect: signedCeilingChangeSchema.exactOptional(),
  onCancel: signedCeilingChangeSchema.exactOptional(),
});

/**
 * A request for a new rescue address at `atMs`, with the ceiling changes kept for it when it starts
 * to wait.
 */
export interface RescueAddressChange {
  readonly address: AccountRef;
  readonly atMs: number;
  readonly ceiling?: RescueCeiling;
}

/** Parses a request for a new rescue address. */
export const rescueAddressChangeSchema: z.ZodType<RescueAddressChange> = z.strictObject({
  address: accountRefSchema,
  atMs: epochMsSchema,
  ceiling: rescueCeilingSchema.exactOptional(),
});

/** The rescue address and the one that waits, in effect before a write and after it. */
export interface RescueMove {
  readonly before: RescueState;
  readonly after: RescueState;
}

/** Parses a rescue move. */
export const rescueMoveSchema: z.ZodType<RescueMove> = z.strictObject({
  before: rescueStateSchema,
  after: rescueStateSchema,
});

/** A cancel of a new rescue address, and the ceiling changes kept for the address it dropped. */
export interface RescueCancel extends RescueMove {
  readonly dropped?: RescueCeiling;
}

/** Parses a rescue cancel. */
export const rescueCancelSchema: z.ZodType<RescueCancel> = z.strictObject({
  before: rescueStateSchema,
  after: rescueStateSchema,
  dropped: rescueCeilingSchema.exactOptional(),
});

/**
 * What the store keeps of the ceiling changes after a rescue move: those of the request when a new
 * address starts to wait, none when no address waits, and the kept ones when the same address
 * still waits. The SQLite store and the fake both write this.
 */
export function rescueCeilingAfter(
  move: RescueMove,
  kept: { readonly stored?: RescueCeiling; readonly asked?: RescueCeiling },
): RescueCeiling | undefined {
  const { pendingRescue } = move.after;
  if (pendingRescue === undefined) {
    return undefined;
  }
  return pendingRescue.atMs === move.before.pendingRescue?.atMs ? kept.stored : kept.asked;
}
