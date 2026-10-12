import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { ProtocolServer } from "@binference/server";
import { createRoutedHandlers } from "../agent-runtime/routed-handlers.js";
import {
  createRuntimeSupervisor,
  type RuntimeHealth,
} from "../agent-runtime/runtime-supervisor.js";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import { builtRuntime } from "../agent-runtime/start-runtime.js";
import { engineEndpoint } from "./engine-locations.js";
import type { Opened, Opening } from "./open-engine-parts.js";

/** The agent runtime as the engine holds it. */
export interface ComposedRuntime {
  /** The runtime's running turns, whose marks its proposals take. */
  readonly turns: RunningTurns;
  /** The handlers of the routed operations, which reach the runtime while it runs. */
  readonly handlers: EngineHandlerTable;
  /** The `runtime` health signal. */
  readonly health: () => RuntimeHealth;
  /**
   * Starts the runtime once the server serves, and adds its closer: the shutdown, which closes the
   * parts last opened first, stops it before every other part.
   */
  begin(server: Pick<ProtocolServer, "endSessions">): void;
}

/**
 * The agent runtime of a self-hosted engine (runtime spec, section 2): the process the host
 * starts, the built one when it names none, with a new token at each start, the engine's IPC
 * address, `agent.sqlite`, `workspace/` and the settings read at the engine's start.
 */
export function composeRuntime(opening: Opening, opened: Opened): ComposedRuntime {
  const { host, platform, closers } = opening;
  const turns = createRunningTurns();
  const ended = { endSessions: (_credential: string): void => undefined };
  const supervisor = createRuntimeSupervisor({
    start: host.startRuntime ?? builtRuntime(host, { agentDb: platform.stateFolder.agentDatabase }),
    makeToken: async (signal) =>
      makeRuntimeToken(
        { access: opened.stores.access, clock: host.clock, random: host.random },
        signal,
      ),
    startLine: {
      endpoint: engineEndpoint(platform).address,
      paths: {
        agentDb: platform.stateFolder.agentDatabase,
        workspace: platform.stateFolder.workspace,
      },
      settings: opened.runtime,
    },
    turns,
    onRevoked: (tokens) => tokens.forEach((token) => ended.endSessions(token)),
    clock: host.clock,
    logger: opened.log.logger.child("runtime"),
  });
  return {
    turns,
    handlers: createRoutedHandlers(async (request, signal) => supervisor.route(request, signal)),
    health: () => supervisor.health(),
    begin(server) {
      ended.endSessions = (credential) => server.endSessions(credential, "auth.revoked");
      supervisor.begin();
      closers.add("runtime", async (signal) => supervisor.stop(signal));
    },
  };
}
