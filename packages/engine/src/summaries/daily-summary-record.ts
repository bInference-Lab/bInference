import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * One agent's daily summary of one date (database spec, `daily_summaries`): sent, muted or not,
 * or found idle and not sent, with the totals it read, which the next day's summary measures its
 * 24-hour change against.
 */
export interface DailySummaryRecord {
  readonly agentId: Id<"agt">;
  /** The owner's date it is for, `YYYY-MM-DD` on the owner's wall clock as it was due. */
  readonly date: string;
  readonly atMs: number;
  /** `sent` when its notice was published, `idle` when the agent had nothing to tell. */
  readonly outcome: "sent" | "idle";
  /** The live holdings' total in micro-dollars; absent when they could not be read. */
  readonly liveUsdMicros?: bigint;
  /** The paper holdings' total in micro-dollars, never added to the live one. */
  readonly paperUsdMicros?: bigint;
}

/** Parses an owner's date, `YYYY-MM-DD`. */
export const ownerDateSchema: z.ZodType<string> = z.iso.date();

/** Parses a daily summary record. */
export const dailySummaryRecordSchema: z.ZodType<DailySummaryRecord> = z.strictObject({
  agentId: idSchema("agt"),
  date: ownerDateSchema,
  atMs: epochMsSchema,
  outcome: z.enum(["sent", "idle"]),
  liveUsdMicros: decimalStringSchema.exactOptional(),
  paperUsdMicros: decimalStringSchema.exactOptional(),
});
