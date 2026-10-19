import { err, type JsonValue, ok, type Result } from "@binference/core";
import type { DcaOrderRequest } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema } from "../records/record-fields.js";
import { nextRunOf } from "../schedules/schedule-times.js";

/**
 * How late a DCA order's period may still buy (decision 0246): the queue runs every 10 seconds
 * while the engine is unlocked, and a buy may wait in its agent's line of fills. A period older
 * than this when the queue sees it was missed; one older than this when its buy reaches the head
 * of the line is late.
 */
const dcaGraceMs = 60_000;

/**
 * What a DCA order keeps in its trigger state (decision 0246): when its next period comes, and
 * the due time of the period whose buy was handed to the fills with it, which the start's repair
 * reads when a stop came between the two.
 */
export interface DcaPeriod {
  readonly nextAtMs: number;
  readonly buying?: number;
}

const dcaPeriodSchema: z.ZodType<DcaPeriod> = z.strictObject({
  nextAtMs: epochMsSchema,
  buying: epochMsSchema.exactOptional(),
});

/** A DCA order's kept period as its `trigger_state` holds it. */
export const dcaPeriodDocument: DocumentCodec<DcaPeriod> = documentCodec(
  "DCA period",
  dcaPeriodSchema,
);

/** The kept period, or none when the order has not kept one yet or what it kept does not read. */
export function periodOf(kept: JsonValue | undefined): DcaPeriod | undefined {
  const parsed = dcaPeriodSchema.safeParse(kept);
  return parsed.success ? parsed.data : undefined;
}

/** Whether a period due at `dueAtMs` is past its minute at `nowMs`. */
export function isPeriodLate(dueAtMs: number, nowMs: number): boolean {
  return nowMs - dueAtMs > dcaGraceMs;
}

/**
 * The first run of the order's period after `afterMs`, on its own zone's wall clock; `undefined`
 * when it runs no more. A cron or zone that no longer reads, such as a zone a later time zone
 * database dropped, is `unreadable`.
 */
export function runAfter(
  request: DcaOrderRequest,
  afterMs: number,
): Result<number | undefined, "unreadable"> {
  const { cron, timezone = "UTC" } = request.trigger;
  const next = nextRunOf({ cron, timezone }, afterMs, timezone);
  return next.ok ? ok(next.value?.nextAtMs) : err("unreadable");
}

/**
 * The order's first two runs after `afterMs`, which its card shows beside the cron so the owner
 * reads how often it buys; `undefined` when its period does not read or runs fewer than twice.
 */
export function firstRunsOf(
  request: DcaOrderRequest,
  afterMs: number,
): readonly [number, number] | undefined {
  const first = runAfter(request, afterMs);
  const second = first.ok && first.value !== undefined ? runAfter(request, first.value) : undefined;
  return first.ok && first.value !== undefined && second?.ok === true && second.value !== undefined
    ? [first.value, second.value]
    : undefined;
}
