import type { Result } from "@binference/core";
import { lockedNotice } from "@binference/engine";
import { privyUnreachableNotice } from "@binference/engine/install";
import { createShutdown, type ShutdownReport, watchFile } from "@binference/platform";
import type { LockReason } from "../unlock/unlock-keys.js";
import { type BotChannel, startBotChannel } from "./bot-channel.js";
import { type ComposedSelfHosted, composeSelfHosted } from "./compose-self-hosted.js";
import { startConfigReload } from "./config-reload.js";
import { startGasCheckTimer } from "./gas-check-timer.js";
import { listenForProtocol, type Opened, type Opening } from "./open-engine-parts.js";
import { startSettleTimer } from "./settle-timer.js";
import type { RunningEngine, StartOutcome } from "./start-outcome.js";
import { startUnlockRetry } from "./unlock-retry.js";

// Hands every part's closer to the one shutdown sequence, which stop signals and `engine/stop`
// start, last opened first: the settle timer, the server, so nothing new comes in, the executor,
// which finishes what it signs and sends, the signer, the stores, the log and the lock.
function startShutdown(
  opening: Opening,
  opened: Opened,
): { readonly stop: () => void; readonly finished: Promise<ShutdownReport> } {
  const { host, platform, closers } = opening;
  const shutdown = createShutdown({
    clock: host.clock,
    budgetMs: opened.config.engine.shutdownBudgetMs,
    events: host.signals,
    signals: platform.stopSignals,
  });
  shutdown.add("announce", async () => opened.log.logger.info("engine.stopping"));
  closers.handTo(shutdown);
  const finished = shutdown.finished.then((report) => {
    shutdown.dispose();
    return report;
  });
  return { stop: () => void shutdown.stop("request"), finished };
}

function isUnreachable(unlocked: Result<void, LockReason>): boolean {
  return !unlocked.ok && unlocked.error === "custody_unreachable";
}

// What runs while the engine serves: the settle timer, the gas check, the reload of
// `config.json5` when it changes (decision 0118), and the retries of the signer step after a start
// that found Privy out of reach (decision 0119).
function startTimers(
  opening: Opening,
  opened: Opened,
  started: { readonly composed: ComposedSelfHosted; readonly isPrivyUnreachable: boolean },
): void {
  const { host, closers } = opening;
  const { logger } = opened.log;
  const { composed } = started;
  const { lock } = composed.locked;
  const timers = { isLocked: () => lock.isLocked(), clock: host.clock, closers, logger };
  startSettleTimer({ settle: composed.settle, ...timers });
  startGasCheckTimer({ checkGas: composed.checkGas, ...timers });
  startConfigReload({
    file: opening.platform.stateFolder.configFile,
    readConfig: opened.readConfig,
    settings: opened.settings,
    journal: { journal: opened.stores.configJournal, publish: composed.publish },
    watch: watchFile,
    clock: host.clock,
    closers,
    logger,
  });
  if (started.isPrivyUnreachable) {
    const { clock, random } = host;
    const onGiveUp = (): void => composed.publish(privyUnreachableNotice());
    startUnlockRetry({ lock, clock, random, closers, logger, onGiveUp });
  }
}

// The owner's bot, when its token was read, as the channels step of the startup order.
function botChannelOf(
  opening: Opening,
  opened: Opened,
  composed: ComposedSelfHosted,
): BotChannel | undefined {
  const { telegram } = composed;
  if (telegram === undefined || opened.bot === undefined) {
    return undefined;
  }
  const { host, closers } = opening;
  const logger = opened.log.logger.child("telegram");
  return startBotChannel({ telegram, token: opened.bot.token, host, closers, logger });
}

/**
 * Serves the engine in the startup order of ARCHITECTURE.md section 24, once the lock, the config,
 * the stores, their migrations and the integrity check are done: the protocol server listens at
 * once, answering every call but `engine/status` with `engine.starting`; the keys open through the
 * unlock mode and start the signer and custody, or leave the engine locked with the reason
 * (decisions 0103 and 0117); every unfinished live intent is recovered by hash and nonce and holds
 * its place in its wallet's queue; once unlocked, the confirmed intents an earlier run left go to
 * the executor; the timer for work that waits for its time starts, the watch on `config.json5`
 * that reloads the settings (decision 0118), and after a start that found Privy out of reach, the
 * signer step's retries (decision 0119); the owner's bot's channel; then the engine is `ready`, or
 * `locked`, and says so on topic `engine`, and the bot starts polling.
 */
export async function serveEngine(opening: Opening, opened: Opened): Promise<StartOutcome> {
  const { platform, signal } = opening;
  const { config, log } = opened;
  const composed = composeSelfHosted(opening, opened);
  const { server, executor, state, locked, publish } = composed;
  const listening = await listenForProtocol(opening, server);
  if (!listening.ok) {
    return listening.error === "port_taken"
      ? { ok: false, refusal: "port_taken", port: config.engine.port }
      : { ok: false, refusal: "already_running", folder: platform.stateFolder.root };
  }
  const unlocked = await locked.lock.unlock({ signal });
  await executor.recover({ signal });
  if (unlocked.ok) {
    await composed.resume(signal);
  }
  startTimers(opening, opened, { composed, isPrivyUnreachable: isUnreachable(unlocked) });
  const channel = botChannelOf(opening, opened, composed);
  const { stop, finished } = startShutdown(opening, opened);
  composed.stopper.stop = stop;
  state.current = "ready";
  server.publish({ topic: "engine", kind: "engine/state", data: { state: locked.state() } });
  log.logger.info("engine.ready");
  channel?.begin();
  if (!unlocked.ok) {
    log.logger.warn("engine.locked", { errorCode: `unlock.${unlocked.error}` });
    publish(lockedNotice());
  }
  const engine: RunningEngine = {
    ...listening.value,
    logFile: log.file,
    state: locked.state(),
    ...(unlocked.ok ? {} : { lockReason: unlocked.error }),
    finished,
  };
  return { ok: true, engine };
}
