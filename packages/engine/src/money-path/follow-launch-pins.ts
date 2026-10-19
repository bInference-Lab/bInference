import { BinferenceError } from "@binference/core";
import type { IntentQuery } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { followedStates, followLaunchPin, type PinFollow } from "./follow-launch-pin.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

// The intents a page reads at a time.
const pageSize = 50;

/** One launch's follow: whether it moved, or that it threw. */
type Followed = { readonly moved: boolean } | { readonly threw: true };

async function followOne(
  options: LaunchPathOptions,
  record: IntentRecord,
  follow: PinFollow,
): Promise<Followed> {
  try {
    const snapshot = await options.stored.snapshot(record.id, follow);
    const moved =
      snapshot === undefined ? snapshot : await followLaunchPin(options, snapshot, follow);
    return { moved: moved !== undefined && moved.record.state !== record.state };
  } catch {
    follow.signal.throwIfAborted();
    return { threw: true };
  }
}

// Every live intent in a followed state, page by page, so launches behind any number of other
// intents are read too.
async function followedRecords(
  options: LaunchPathOptions,
  signal: AbortSignal,
): Promise<readonly IntentRecord[]> {
  const read: IntentRecord[] = [];
  let after: IntentQuery["after"];
  for (;;) {
    const query = { states: [...followedStates], isPaper: false, limit: pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last
    const page = await options.stored.list(after === undefined ? query : { ...query, after }, {
      signal,
    });
    read.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) {
      return read;
    }
    after = { changedAtMs: last.changedAtMs, id: last.id };
  }
}

/**
 * Follows every live token launch in `checked`, `quoted`, `assessed` or `simulated`
 * ({@link followLaunchPin}): a timer of the composition root calls it every 3 seconds, and the
 * startup once as its repair. It reads every page of such intents, and one launch that throws
 * never stops the others: once all are followed, it throws `engine.pin_check_failed` naming the
 * launches that threw. Answers how many launches it moved.
 */
export async function followLaunchPins(
  options: LaunchPathOptions,
  follow: PinFollow,
): Promise<number> {
  const records = await followedRecords(options, follow.signal);
  const launches = records.filter((record) => record.kind === "launchToken");
  const followed: Followed[] = [];
  for (const record of launches) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one launch at a time, each its own writes
    followed.push(await followOne(options, record, follow));
  }
  const failed = launches.filter((_record, index) => {
    const one = followed[index];
    return one !== undefined && "threw" in one;
  });
  const [first] = failed;
  if (first !== undefined) {
    throw new BinferenceError({
      code: "engine.pin_check_failed",
      message: "The follow of one or more token launches failed; the others went on.",
      details: { intents: failed.map((record) => record.id).join(","), count: failed.length },
    });
  }
  return followed.filter((one) => "moved" in one && one.moved).length;
}
