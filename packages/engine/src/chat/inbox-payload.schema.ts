import { type Id, idSchema } from "@binference/core";
import {
  type AlertFire,
  alertFireSchema,
  type AlertView,
  alertViewSchema,
  chatSurfaceSchema,
  type ChatSurface,
  choicePlaceSchema,
} from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

// The payload of each kind of agent inbox message, as `agent_inbox.payload` stores it: the kind's
// own fields of the runtime spec's section 3.3, in their wire form.

/**
 * An owner's message: its text, its images' upload ids, the surface it came from, and for a press
 * of a question's button, the question and the place of the choice pressed.
 */
export interface OwnerMessagePayload {
  readonly text: string;
  readonly images?: readonly string[];
  readonly surface: ChatSurface;
  readonly answer?: { readonly question: Id<"qst">; readonly choice: number };
}

/** Parses an owner's message payload. */
export const ownerMessagePayloadSchema: z.ZodType<OwnerMessagePayload> = z.strictObject({
  text: z.string(),
  images: z.array(z.string().min(1)).min(1).max(4).exactOptional(),
  surface: chatSurfaceSchema,
  answer: z.strictObject({ question: idSchema("qst"), choice: choicePlaceSchema }).exactOptional(),
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

/** A schedule's wake-up: the schedule, its prompt, when the run was due, and its mark. */
export interface ScheduleDuePayload {
  readonly schedule: Id<"sch">;
  readonly prompt: string;
  readonly due: number;
  readonly outsideContent: boolean;
}

/** Parses a wake-up's payload. */
export const scheduleDuePayloadSchema: z.ZodType<ScheduleDuePayload> = z.strictObject({
  schedule: idSchema("sch"),
  prompt: z.string(),
  due: epochMsSchema,
  outsideContent: z.boolean(),
});

/** An alert's wake-up: the alert as its fire left it, what fired it, and its mark. */
export interface AlertFiredPayload {
  readonly alert: AlertView;
  readonly fired: AlertFire;
  readonly outsideContent: boolean;
}

/** Parses an alert wake-up's payload, as the protocol's JSON writes it. */
export const alertFiredPayloadSchema: z.ZodType<AlertFiredPayload> = z.strictObject({
  alert: alertViewSchema,
  fired: alertFireSchema,
  outsideContent: z.boolean(),
});
