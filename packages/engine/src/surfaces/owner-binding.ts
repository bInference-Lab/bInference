import { type Id, idSchema } from "@binference/core";
import { z } from "zod";

/** The Telegram user who owns this install, paired with a start code. */
export interface OwnerBinding {
  /** The owner's numeric Telegram user id; a username is never trusted. */
  readonly userId: number;
  readonly pairedAtMs: number;
  /** The agent the owner's chat talks to, as `/use` picked it (decision 0204). */
  readonly agentId?: Id<"agt">;
}

/** Parses an owner binding. */
export const ownerBindingSchema: z.ZodType<OwnerBinding> = z.strictObject({
  userId: z.int().positive(),
  pairedAtMs: z.int().nonnegative(),
  agentId: idSchema("agt").exactOptional(),
});
