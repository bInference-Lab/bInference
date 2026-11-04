import { join } from "node:path";
import { BinferenceError, err, ok } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import { updatedNotice, updateRolledBackNotice } from "@binference/engine/notices";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { holdsRunningFiles } from "@binference/platform";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { npmRegistry } from "../plugins/npm-registry.js";
import { readPluginLock } from "../plugins/plugin-lock.js";
import {
  type CountsLine,
  type DailyUpdateCheckParts,
  runDailyUpdateCheck,
  type UpdateCheckSettings,
} from "../updates/daily-update-check.js";
import { findUpdate, updateUserAgent, updateViewOf } from "../updates/find-update.js";
import { createReleaseFeed, type ReleaseFeed } from "../updates/release-feed.js";
import { countsOf, countsUrl, sendCounts } from "../updates/update-counts.js";
import { removeLeftovers } from "../updates/update-lock.js";
import { clearUpdateState, readUpdateState } from "../updates/update-state.js";
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
    countsOn: config.telemetry.enabled,
  };
}

// How many community plugins the plugin lock holds on; none when it does not read.
async function communityPluginsOn(stateRoot: string, signal: AbortSignal): Promise<number> {
  const lock = await readPluginLock(join(stateRoot, "plugins", "lock.json"), signal);
  return lock.ok ? lock.value.plugins.filter((plugin) => plugin.enabled).length : 0;
}

// The counts drawn from the agents not archived, the config and the plugin lock, and sent to
// binference.io, or the host's own address in tests.
function countsLineOf(opening: Opening, opened: Opened): CountsLine {
  const { host, platform } = opening;
  const { agents } = opened.stores;
  const send = {
    http: host.http,
    url: host.countsUrl ?? countsUrl,
    userAgent: updateUserAgent(host.version, host.system),
  };
  return {
    read: async (signal) => {
      const records = (await agents.list({ signal })).filter(
        (agent) => agent.archivedAtMs === undefined,
      );
      const settings = await Promise.all(
        records.map(async (agent) => agents.get(agent.id, { signal })),
      );
      return countsOf({
        version: host.version,
        os: host.system.os,
        agents: settings.flatMap((held) =>
          held === undefined ? [] : [{ mode: held.agent.mode, venues: held.limits.venues }],
        ),
        binanceOn: opened.settings.current().cex.binance.enabled,
        communityPluginsOn: await communityPluginsOn(platform.stateFolder.root, signal),
      });
    },
    send: async (counts, signal) => sendCounts(send, counts, signal),
  };
}

/**
 * `update/check` (protocol spec, section 7.9; decision 0355): the newest release on
 * `updates.channel` from npm at once, whatever `updates.check` says, with its notes; it records
 * and announces nothing. A registry that gives nothing to use is `update.registry_unreachable`.
 * `update/apply` is unserved in v1 (decision 0356): it answers `update.terminal_only`, since only
 * `binference update` in the terminal updates.
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
    "update/apply": async () => err("update.terminal_only"),
  };
}

/** The update operations of the self-hosted engine, over npm's registry and the config cell. */
export function composeUpdateOperations(opening: Opening, opened: Opened): EngineHandlerTable {
  const feed = releaseFeedOf(opening);
  return createUpdateOperations({ feed, version: opening.host.version, settings: opened.settings });
}

/**
 * Starts the daily update check of the self-hosted engine (decision 0355), which reads its
 * switch, channel, the owner's language and `telemetry.enabled` from the config cell each time,
 * tells the owner through `publish`, and sends the opt-in counts while telemetry is on.
 */
export function startUpdateChecks(opening: Opening, opened: Opened, publish: PublishPush): void {
  const { host, platform, closers } = opening;
  const parts: DailyUpdateCheckParts = {
    feed: releaseFeedOf(opening),
    version: host.version,
    // Where `binference update` refuses, the notice names the steps that install by hand.
    steps: holdsRunningFiles(host.system) ? "manual" : "update",
    settings: () => checkSettingsOf(opened.settings.current()),
    stateRoot: platform.stateFolder.root,
    permissions: platform.permissions,
    publish,
    counts: countsLineOf(opening, opened),
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

// The outcome the record holds for this version: the update it finished, or the rollback to it.
async function tellOutcome(opening: Opening, opened: Opened, publish: PublishPush): Promise<void> {
  const { signal } = opening;
  const root = opening.platform.stateFolder.root;
  const running = opening.host.version;
  const state = await readUpdateState(root, signal);
  if (state?.state === "updated" && state.to === running) {
    const notes = state.notes?.[opened.settings.current().owner.locale] ?? [];
    await clearUpdateState(root, signal);
    publish(updatedNotice(state.to, notes));
  } else if (state?.state === "rolled_back" && state.from === running) {
    await clearUpdateState(root, signal);
    publish(updateRolledBackNotice(state.to, state.from));
  }
}

/**
 * Tells the owner, once the engine serves, how the last `binference update` ended (decision
 * 0356): `notice.updated`, with the release's notes in the owner's language, when this version is
 * the one it installed, or `notice.updateRolledBack` when it put this version back. The record
 * goes before the notice, so a restart never tells it twice. Once the record is final, or there is
 * none, and no update runs, it removes the copies and tarballs an interrupted update left. A record
 * that cannot be read or removed is logged as `update.outcome_unread`, and nothing is told.
 */
export async function tellUpdateOutcome(
  opening: Opening,
  opened: Opened,
  publish: PublishPush,
): Promise<void> {
  const { platform, signal } = opening;
  const kept = { stateFolder: platform.stateFolder, permissions: platform.permissions, signal };
  try {
    await tellOutcome(opening, opened, publish);
    await removeLeftovers(kept);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    opened.log.logger.warn("update.outcome_unread", { errorCode });
  }
}
