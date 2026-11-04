import { err, ok } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { npmRegistry } from "../plugins/npm-registry.js";
import { runDailyUpdateCheck, type UpdateCheckSettings } from "../updates/daily-update-check.js";
import { findUpdate, updateUserAgent, updateViewOf } from "../updates/find-update.js";
import { createReleaseFeed, type ReleaseFeed } from "../updates/release-feed.js";
import type { ConfigCell } from "./config-cell.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { startUpdateTimer } from "./update-timer.js";

/** The release feed of this install: npm's registry, or the host's stand-in, through `host.http`. */
function releaseFeedOf(opening: Opening): ReleaseFeed {
  const { host } = opening;
  return createReleaseFeed({
    http: host.http,
    registry: host.npmRegistry ?? npmRegistry,
    userAgent: updateUserAgent(host.version, host.system),
    clock: host.clock,
  });
}

function checkSettingsOf(config: BinferenceConfig): UpdateCheckSettings {
  return {
    isOn: config.updates.check,
    channel: config.updates.channel,
    locale: config.owner.locale,
  };
}

/**
 * `update/check` (protocol spec, section 7.9; decision 0355): the newest release on
 * `updates.channel` from npm at once, whatever `updates.check` says, with its notes; it records
 * and announces nothing. A registry that gives nothing to use is `update.registry_unreachable`.
 */
function createUpdateOperations(parts: {
  readonly feed: ReleaseFeed;
  readonly version: string;
  readonly settings: ConfigCell;
}): EngineHandlerTable {
  return {
    "update/check": async ({ signal }) => {
      const config = parts.settings.current();
      const ask = { current: parts.version, channel: config.updates.channel };
      const found = await findUpdate(parts.feed, ask, signal);
      return found.ok
        ? ok(updateViewOf(found.value, config.owner.locale))
        : err("update.registry_unreachable");
    },
  };
}

/** The update operations of the self-hosted engine, over npm's registry and the config cell. */
export function composeUpdateOperations(opening: Opening, opened: Opened): EngineHandlerTable {
  const feed = releaseFeedOf(opening);
  return createUpdateOperations({ feed, version: opening.host.version, settings: opened.settings });
}

/**
 * Starts the daily update check of the self-hosted engine (decision 0355), which reads its
 * switch, channel and the owner's language from the config cell each time and tells the owner
 * through `publish`.
 */
export function startUpdateChecks(opening: Opening, opened: Opened, publish: PublishPush): void {
  const { host, platform, closers } = opening;
  const parts = {
    feed: releaseFeedOf(opening),
    version: host.version,
    settings: () => checkSettingsOf(opened.settings.current()),
    stateRoot: platform.stateFolder.root,
    permissions: platform.permissions,
    publish,
    logger: opened.log.logger,
  };
  startUpdateTimer({
    check: async ({ signal }) => runDailyUpdateCheck(parts, signal),
    clock: host.clock,
    random: host.random,
    closers,
    logger: opened.log.logger,
  });
}
