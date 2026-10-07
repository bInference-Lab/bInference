import { ok } from "@binference/core";
import type { AgentStore } from "@binference/engine";
import { type EngineState, protocolVersion, type ResultOf } from "@binference/protocol";
import type { OperationHandlers } from "@binference/server";
import type { HealthSignal } from "./health-signals.js";

/** What the engine's own operations read and do. */
export interface EngineOperationsOptions {
  readonly agents: Pick<AgentStore, "list">;
  /** The engine's release. */
  readonly version: string;
  readonly state: () => EngineState;
  readonly health: () => readonly HealthSignal[];
  /**
   * Starts the shutdown sequence. It must not wait for the sequence: the sequence closes the
   * server that answers the call.
   */
  readonly stop: () => void;
}

type EngineStatus = ResultOf<"engine/status">;

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
 * The handlers of `engine/status` and `engine/stop`. Status answers the state, the release, the
 * protocol version, the agents that are not archived, and the health signals; the engine counts
 * as frozen when it has agents and every one of them is frozen. Stop starts the shutdown sequence
 * and answers at once.
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
    "engine/stop": async () => {
      options.stop();
      return Promise.resolve(ok({}));
    },
  };
}
