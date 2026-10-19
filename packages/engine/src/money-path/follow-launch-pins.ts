import { BinferenceError } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import { followedStates, followLaunchPin, type PinFollow } from "./follow-launch-pin.js";
import { liveIntentsIn } from "./live-intents.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

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
  const states = [...followedStates];
  const records = await liveIntentsIn(options.stored, { states }, follow.signal);
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
