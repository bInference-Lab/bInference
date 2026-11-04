import type { Logger } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import { updateNotice } from "@binference/engine/notices";
import type { FilePermissions } from "@binference/platform";
import type { Locale } from "@binference/protocol";
import { readAnnouncedUpdate, writeAnnouncedUpdate } from "./announced-update.js";
import { findUpdate } from "./find-update.js";
import type { ReleaseChannel, ReleaseFeed } from "./release-feed.js";

/** What the daily check reads from the config as it stands when it runs. */
export interface UpdateCheckSettings {
  /** `updates.check`: whether the check runs at all. */
  readonly isOn: boolean;
  readonly channel: ReleaseChannel;
  /** `owner.locale`: the language of the notes the notice shows. */
  readonly locale: Locale;
}

/** What one daily check runs on. */
export interface DailyUpdateCheckParts {
  readonly feed: ReleaseFeed;
  /** The running binference's version. */
  readonly version: string;
  readonly settings: () => UpdateCheckSettings;
  /** The state folder, whose `updates/announced.json` keeps the release told last. */
  readonly stateRoot: string;
  readonly permissions: FilePermissions;
  /** The engine's one publish, where the notice goes. */
  readonly publish: PublishPush;
  readonly logger: Logger;
}

/**
 * One daily update check (decision 0355), while `updates.check` is on: the newest release on the
 * channel from npm, and when it is newer than the running version and not the one told last, the
 * record of it, then `notice.update` with its notes in the owner's language, or
 * `notice.updateBare`. A registry that gives nothing to use is logged as `update.check_failed`
 * and raises no notice. A record that cannot be written stops the notice, so a restart never tells
 * a release twice.
 */
export async function runDailyUpdateCheck(
  parts: DailyUpdateCheckParts,
  signal: AbortSignal,
): Promise<void> {
  const settings = parts.settings();
  if (!settings.isOn) {
    return;
  }
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
  parts.publish(updateNotice(latest, releaseNotes?.[settings.locale] ?? []));
}
