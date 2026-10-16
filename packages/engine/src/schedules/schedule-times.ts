import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { ScheduleWhen } from "@binference/protocol";
import { parseCron } from "./cron-fields.js";
import { nextCronRun } from "./next-cron-run.js";
import type { ScheduleNext } from "./schedule-record.js";

// A cron expression's next run in a zone, or `bad_when` for a zone Intl does not know.
function cronRun(
  when: { readonly cron: string; readonly timezone?: string },
  afterMs: number,
  ownerZone: string,
): Result<ScheduleNext | undefined, "bad_when"> {
  const fields = parseCron(when.cron);
  if (!fields.ok) {
    return err("bad_when");
  }
  const zone = when.timezone ?? ownerZone;
  try {
    const nextAtMs = nextCronRun(fields.value, afterMs, zone);
    return ok(nextAtMs === undefined ? undefined : { nextAtMs, zone });
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "i18n.bad_time_zone") {
      return err("bad_when");
    }
    throw error;
  }
}

/**
 * A schedule's first run later than `afterMs` (decision 0231): a cron expression's on the wall
 * clock of its own zone, or of `ownerZone`, `owner.timezone` now, when it names none; a one-time
 * schedule's `at` while it is still ahead. `undefined` when it runs no more. An expression or a
 * zone binference cannot read is `bad_when`.
 */
export function nextRunOf(
  when: ScheduleWhen,
  afterMs: number,
  ownerZone: string,
): Result<ScheduleNext | undefined, "bad_when"> {
  if ("at" in when) {
    return ok(when.at > afterMs ? { nextAtMs: when.at } : undefined);
  }
  return cronRun(when, afterMs, ownerZone);
}
