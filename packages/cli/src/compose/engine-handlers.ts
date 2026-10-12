import type { EnginePush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { RuntimeHealth } from "../agent-runtime/runtime-supervisor.js";
import { composeBackupOperations } from "./backup-operations.js";
import type { ComposedLock } from "./compose-lock.js";
import { createEngineOperations } from "./engine-operations.js";
import { type HealthSignal, startHealthProbe } from "./health-signals.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { createTelegramPair } from "./telegram-pair.js";

/** What the engine's own operations answer from besides the stores. */
interface EngineWiring {
  /** The call that `engine/stop` makes once the shutdown sequence exists. */
  readonly stopper: { readonly stop: () => void };
  /** The engine lock, whose state `engine/status` reports and `engine/unlock` opens. */
  readonly locked: ComposedLock;
  /** Where a long job's end goes, once the engine's publish exists. */
  readonly jobs: { publish: (push: EnginePush) => void };
  /** The `rpc` health signal: how the chains' RPC endpoints answered. */
  readonly rpc: () => HealthSignal["state"];
  /** The executor's health signal. */
  readonly executor: () => HealthSignal["state"];
  /** The custody signal: ok while custody is open, failing while the engine is locked. */
  readonly custody: () => HealthSignal["state"];
  /** The backup key signal: a warning while backups are still sealed to the owner key itself. */
  readonly backupKey: () => HealthSignal["state"];
  /** The agent runtime's signal: failing, since it went down, while it is down or starting. */
  readonly runtime: () => RuntimeHealth;
  /** The price watchers' signal, with their lag in blocks while one reads. */
  readonly watcher: () => HealthSignal;
}

/**
 * The engine's own operations: its status with the health signals, its stop, its unlock, a new
 * pairing link for the owner's bot, and the backups.
 */
export function engineHandlers(
  opening: Opening,
  opened: Opened,
  wiring: EngineWiring,
): EngineHandlerTable {
  const probe = startHealthProbe({
    parts: [
      { signal: "executor", state: wiring.executor },
      { signal: "custody", state: wiring.custody },
      { signal: "rpc", state: wiring.rpc },
      { signal: "backup_key", state: wiring.backupKey },
      {
        signal: "runtime",
        state: () => wiring.runtime().state,
        since: () => wiring.runtime().since,
      },
    ],
    signals: [wiring.watcher],
    logFailed: opened.log.hasFailed,
  });
  opening.closers.add("health", async () => probe.stop());
  const { clock, random } = opening.host;
  return {
    ...createEngineOperations({
      agents: opened.stores.agents,
      version: opening.host.version,
      state: wiring.locked.state,
      lock: wiring.locked.lock,
      health: () => probe.read(),
      stop: () => wiring.stopper.stop(),
    }),
    ...createTelegramPair({ api: opened.bot?.api, access: opened.stores.access, clock, random }),
    ...composeBackupOperations(opening, opened, (push) => wiring.jobs.publish(push)),
  };
}
