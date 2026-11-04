import type { Logger } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import { type UpdateSteps, updateNotice } from "@binference/engine/notices";
import type { FilePermissions } from "@binference/platform";
import type { Locale } from "@binference/protocol";
import { readAnnouncedUpdate, writeAnnouncedUpdate } from "./announced-update.js";
import { findUpdate } from "./find-update.js";
import type { ReleaseChannel, ReleaseFeed } from "./release-feed.js";
import type { UpdateCounts } from "./update-counts.js";

/** What the daily check reads from the config as it stands when it runs. */
export interface UpdateCheckSettings {
  /** `updates.check`: whether the check runs at all. */
  readonly isOn: boolean;
  readonly channel: ReleaseChannel;
  /** `owner.locale`: the language of the notes the notice shows. */
  readonly locale: Locale;
  /** `telemetry.enabled`: whether the check sends the opt-in counts. */
  readonly countsOn: boolean;
}

/** Where the opt-in counts come from and go. */
export interface CountsLine {
  /** Draws the counts from the install as it stands. */
  readonly read: (signal: AbortSignal) => Promise<UpdateCounts>;
  /** Sends them; answers whether the endpoint took them. */
  readonly send: (counts: UpdateCounts, signal: AbortSignal) => Promise<boolean>;
}

/** What one daily check runs on. */
export interface DailyUpdateCheckParts {
  readonly feed: ReleaseFeed;
  /** The running binference's version. */
  readonly version: string;
  /** How the owner installs a newer release on this machine. */
  readonly steps: UpdateSteps;
  readonly settings: () => UpdateCheckSettings;
  /** The state folder, whose `updates/announced.json` keeps the release told last. */
  readonly stateRoot: string;
  readonly permissions: FilePermissions;
  /** The engine's one publish, where the notice goes. */
  readonly publish: PublishPush;
  readonly counts: CountsLine;
  readonly logger: Logger;
}

// The newest release on the channel, told once: its record first, then its notice.
async function tellNewRelease(
  parts: DailyUpdateCheckParts,
  settings: UpdateCheckSettings,
  signal: AbortSignal,
): Promise<void> {
  const { channel } = settings;
  const found = await findUpdate(parts.feed, { current: parts.version, channel }, signal);
  if (!found.ok) {
    parts.logger.warn("update.check_failed", { errorCode: "update.registry_unreachable" });
    return;
  }
  const { latest, releaseNotes } = found.value;
  if (latest === undefined) {
    return;
  }
  const announced = await readAnnouncedUpdate(parts.stateRoot, signal);
  if (announced?.channel === channel && announced.version === latest) {
    return;
  }
  const { permissions } = parts;
  await writeAnnouncedUpdate(
    parts.stateRoot,
    { channel, version: latest },
    { permissions, signal },
  );
  parts.publish(updateNotice(latest, releaseNotes?.[settings.locale] ?? [], parts.steps));
}

// The counts, which fail soft: a failure is a debug line and nothing more.
async function sendCounts(parts: DailyUpdateCheckParts, signal: AbortSignal): Promise<void> {
  try {
    const taken = await parts.counts.send(await parts.counts.read(signal), signal);
    if (!taken) {
      parts.logger.debug("update.counts_failed");
    }
  } catch {
    signal.throwIfAborted();
    parts.logger.debug("update.counts_failed");
  }
}

/**
 * One daily update check (decision 0355), while `updates.check` is on: the newest release on the
 * channel from npm, and when it is newer than the running version and not the one told last, the
 * record of it, then `notice.update` with its notes in the owner's language, or
 * `notice.updateBare`. A registry that gives nothing to use is logged as `update.check_failed`
 * and raises no notice. A record that cannot be written stops the notice, so a restart never tells
 * a release twice. Then, whatever the check found, the opt-in counts while `telemetry.enabled` is
 * on, and none while it is off.
 */
export async function runDailyUpdateCheck(
  parts: DailyUpdateCheckParts,
  signal: AbortSignal,
): Promise<void> {
  const settings = parts.settings();
  if (!settings.isOn) {
    return;
  }
  try {
    await tellNewRelease(parts, settings, signal);
  } finally {
    if (settings.countsOn && !signal.aborted) {
      await sendCounts(parts, signal);
    }
  }
}
