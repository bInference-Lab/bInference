import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import type { PendingRescue, RescueState } from "../policy/rescue-change.js";
import { epochMsSchema } from "../records/record-fields.js";

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

/** A request for a new rescue address at `atMs`. */
export interface RescueAddressChange {
  readonly address: AccountRef;
  readonly atMs: number;
}

/** Parses a request for a new rescue address. */
export const rescueAddressChangeSchema: z.ZodType<RescueAddressChange> = z.strictObject({
  address: accountRefSchema,
  atMs: epochMsSchema,
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
