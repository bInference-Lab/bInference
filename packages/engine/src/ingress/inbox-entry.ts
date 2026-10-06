import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema } from "../records/record-fields.js";

/** Where an inbound event came from. */
export type InboxSource = "telegram" | "webhook";

/**
 * An inbound event as it arrives, stored before it is acknowledged. `sourceKey` names it at its
 * source, such as `tg:<bot>:<update>` for a Telegram update.
 */
export interface InboxDraft {
  readonly source: InboxSource;
  readonly sourceKey: string;
  readonly payload: JsonValue;
  readonly receivedAtMs: number;
}

const draftShape = {
  source: z.enum(["telegram", "webhook"]),
  sourceKey: z.string().min(1).max(256),
  payload: jsonValueSchema,
  receivedAtMs: epochMsSchema,
};

/** Parses an inbox draft. */
export const inboxDraftSchema: z.ZodType<InboxDraft> = z.strictObject(draftShape);

/** An inbound event in the inbox; `handledAtMs` is set once, when it was handled. */
export interface InboxEntry extends InboxDraft {
  readonly id: number;
  readonly handledAtMs?: number;
}

/** Parses an inbox entry. */
export const inboxEntrySchema: z.ZodType<InboxEntry> = z.strictObject({
  ...draftShape,
  id: rowNumberSchema,
  handledAtMs: epochMsSchema.exactOptional(),
});

/** An admitted event: `new` the first time its source key arrives, `repeat` with the first entry after. */
export interface InboxAdmission {
  readonly kind: "new" | "repeat";
  readonly entry: InboxEntry;
}

/** Parses an admission. */
export const inboxAdmissionSchema: z.ZodType<InboxAdmission> = z.strictObject({
  kind: z.enum(["new", "repeat"]),
  entry: inboxEntrySchema,
});
