import { BinferenceError, createSecret, ok } from "@binference/core";
import type { AgentStore } from "@binference/engine";
import { type EngineState, protocolVersion, type ResultOf } from "@binference/protocol";
import type { OperationHandlers } from "@binference/server";
import type { EngineLock } from "../unlock/engine-lock.js";
import type { LockReason } from "../unlock/unlock-keys.js";
import type { HealthSignal } from "./health-signals.js";

/** What the engine's own operations read and do. */
export interface EngineOperationsOptions {
  readonly agents: Pick<AgentStore, "list">;
  /** The engine's release. */
  readonly version: string;
  readonly state: () => EngineState;
  /** Opens the agent key for `engine/unlock`. */
  readonly lock: Pick<EngineLock, "unlock">;
  readonly health: () => readonly HealthSignal[];
  /**
   * Starts the shutdown sequence. It must not wait for the sequence: the sequence closes the
   * server that answers the call.
   */
  readonly stop: () => void;
}

type EngineStatus = ResultOf<"engine/status">;

// A call sent again unchanged cannot pass for these: it needs another passphrase or a restart.
const finalReasons: ReadonlySet<LockReason> = new Set([
  "needs_passphrase",
  "wrong_passphrase",
  "app_secret_missing",
]);

// The handler's answer carries no details, so the refusal travels as the protocol code it is.
function lockedFault(reason: LockReason): BinferenceError {
  return new BinferenceError({
    code: "engine.locked",
    message: `The agent key did not open: ${reason}.`,
    retryable: !finalReasons.has(reason),
    details: { reason },
  });
}

function agentsOf(records: Awaited<ReturnType<AgentStore["list"]>>): EngineStatus["agents"] {
  return records
    .filter((record) => record.archivedAtMs === undefined)
    .map((record) => ({
      id: record.id,
      mode: record.mode,
      frozen: record.frozenAtMs !== undefined,
    }));
}

/**
 * The handlers of `engine/status`, `engine/stop` and `engine/unlock`. Status answers the state, the
 * release, the protocol version, the agents that are not archived, and the health signals; the
 * engine counts as frozen when it has agents and every one of them is frozen. Stop starts the
 * shutdown sequence and answers at once. Unlock opens the agent key, with the passphrase in the
 * `manual` mode, and fails with `engine.locked` and the reason in `details.reason` while it stays
 * locked (decision 0104).
 */
export function createEngineOperations(options: EngineOperationsOptions): OperationHandlers {
  return {
    "engine/status": async ({ signal }) => {
      const agents = agentsOf(await options.agents.list({ signal }));
      return ok({
        state: options.state(),
        version: options.version,
        protocol: protocolVersion,
        frozen: agents.length > 0 && agents.every((agent) => agent.frozen),
        agents,
        health: options.health(),
      });
    },
    "engine/unlock": async ({ args, signal }) => {
      const { passphrase } = args;
      const typed = passphrase === undefined ? {} : { passphrase: createSecret(passphrase) };
      const unlocked = await options.lock.unlock({ ...typed, signal });
      if (!unlocked.ok) {
        throw lockedFault(unlocked.error);
      }
      return ok({});
    },
    "engine/stop": async () => {
      options.stop();
      return Promise.resolve(ok({}));
    },
  };
}
