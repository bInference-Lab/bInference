import { lockedNotice } from "@binference/engine";
import { createShutdown, type ShutdownReport } from "@binference/platform";
import { composeSelfHosted } from "./compose-self-hosted.js";
import { listenForProtocol, type Opened, type Opening } from "./open-engine-parts.js";
import type { RunningEngine, StartOutcome } from "./start-outcome.js";

// Hands every part's closer to the one shutdown sequence, which stop signals and `engine/stop`
// start: the server first, so nothing new comes in, then the executor, the stores, the log and
// the lock.
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

/**
 * Serves the engine in the startup order of ARCHITECTURE.md section 24, once the lock, the config,
 * the stores, their migrations and the integrity check are done: the protocol server listens at
 * once, answering every call but `engine/status` with `engine.starting`; the keys open through the
 * unlock mode and start the signer and custody, or leave the engine locked with the reason
 * (decisions 0103 and 0117); every unfinished live intent is recovered by hash and nonce and holds
 * its place in its wallet's queue; once unlocked, the confirmed intents an earlier run left go to
 * the executor; then the engine is `ready`, or `locked`, and says so on topic `engine`.
 */
export async function serveEngine(opening: Opening, opened: Opened): Promise<StartOutcome> {
  const { platform, signal } = opening;
  const { config, log } = opened;
  const composed = composeSelfHosted(opening, opened);
  const { server, executor, state, locked } = composed;
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
  const { stop, finished } = startShutdown(opening, opened);
  composed.stopper.stop = stop;
  state.current = "ready";
  server.publish({ topic: "engine", kind: "engine/state", data: { state: locked.state() } });
  log.logger.info("engine.ready");
  if (!unlocked.ok) {
    log.logger.warn("engine.locked", { errorCode: `unlock.${unlocked.error}` });
    server.publish(lockedNotice());
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
