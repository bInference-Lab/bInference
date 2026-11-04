import { err, ok, type Result } from "@binference/core";
import type { SystemFacts } from "@binference/platform";
import type { Locale, ReleaseNotes, ResultOf } from "@binference/protocol";
import { isNewerVersion, type ReleaseChannel, type ReleaseFeed } from "./release-feed.js";

/** What a check found: the running version, the channel, and a newer release with its notes. */
export interface FoundUpdate {
  readonly current: string;
  readonly channel: ReleaseChannel;
  /** The newest release on the channel, only when it is newer than the running one. */
  readonly latest?: string;
  /** Its notes for owners, when it carries any. */
  readonly releaseNotes?: ReleaseNotes;
}

/**
 * The user agent of the update check (decision 0355): binference and its version, then Node's
 * version, the OS and the CPU type, and nothing else.
 */
export function updateUserAgent(version: string, system: SystemFacts): string {
  return `binference/${version} node/${system.node} ${system.os} ${system.cpu}`;
}

/**
 * Asks the feed for the newest release on the channel and, when it is newer than the running
 * version, for its notes. `unreachable` when the registry gave nothing to use.
 */
export async function findUpdate(
  feed: ReleaseFeed,
  ask: { readonly current: string; readonly channel: ReleaseChannel },
  signal: AbortSignal,
): Promise<Result<FoundUpdate, "unreachable">> {
  const newest = await feed.newest(ask.channel, signal);
  if (!newest.ok) {
    return err("unreachable");
  }
  const latest = newest.value;
  if (latest === undefined || !isNewerVersion(latest, ask.current)) {
    return ok(ask);
  }
  const releaseNotes = await feed.notes(latest, signal);
  return ok(releaseNotes === undefined ? { ...ask, latest } : { ...ask, latest, releaseNotes });
}

/** The answer of `update/check` for a check's finding, its notes in the owner's language. */
export function updateViewOf(found: FoundUpdate, locale: Locale): ResultOf<"update/check"> {
  const { current, channel, latest, releaseNotes } = found;
  const lines = releaseNotes?.[locale] ?? [];
  return {
    current,
    channel,
    ...(latest === undefined ? {} : { latest }),
    ...(lines.length === 0 ? {} : { notes: lines.join("\n") }),
    ...(releaseNotes === undefined ? {} : { releaseNotes }),
  };
}
