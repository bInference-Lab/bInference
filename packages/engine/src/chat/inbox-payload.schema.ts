import { type Id, idSchema } from "@binference/core";
import { chatSurfaceSchema, type ChatSurface } from "@binference/protocol";
import { z } from "zod";

// The payload of each kind of agent inbox message, as `agent_inbox.payload` stores it: the kind's
// own fields of the runtime spec's section 3.3, in their wire form.

/** An owner's message: its text, its images' upload ids and the surface it came from. */
export interface OwnerMessagePayload {
  readonly text: string;
  readonly images?: readonly string[];
  readonly surface: ChatSurface;
}

/** Parses an owner's message payload. */
export const ownerMessagePayloadSchema: z.ZodType<OwnerMessagePayload> = z.strictObject({
  text: z.string(),
  images: z.array(z.string().min(1)).min(1).max(4).exactOptional(),
  surface: chatSurfaceSchema,
});

/** A settle message: the intent that ended. */
export interface SettlePayload {
  readonly intent: Id<"int">;
}

/** Parses a settle message's payload. */
export const settlePayloadSchema: z.ZodType<SettlePayload> = z.strictObject({
  intent: idSchema("int"),
});

/** A stop: who stopped the turn. */
export interface StopPayload {
  readonly reason: "owner" | "freeze";
}

/** Parses a stop's payload. */
export const stopPayloadSchema: z.ZodType<StopPayload> = z.strictObject({
  reason: z.enum(["owner", "freeze"]),
});

/** A clear: the session that follows. */
export interface ClearPayload {
  readonly next: Id<"ses">;
}

/** Parses a clear's payload. */
export const clearPayloadSchema: z.ZodType<ClearPayload> = z.strictObject({
  next: idSchema("ses"),
});
