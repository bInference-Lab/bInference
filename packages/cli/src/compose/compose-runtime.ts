import { BinferenceError, type Id } from "@binference/core";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { AgentModelPicks, RuntimeSettings } from "@binference/runtime";
import type { ProtocolServer } from "@binference/server";
import { createRoutedHandlers } from "../agent-runtime/routed-handlers.js";
import {
  createRuntimeSupervisor,
  type RuntimeHealth,
  type RuntimeSupervisor,
} from "../agent-runtime/runtime-supervisor.js";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import { builtRuntime } from "../agent-runtime/start-runtime.js";
import { engineEndpoint } from "./engine-locations.js";
import { type AgentPicks, picksOf } from "./model-operations.js";
import type { Opened, Opening } from "./open-engine-parts.js";

// The roles the runtime runs a picked model for; a picked vision model waits for image reading.
function runtimePicks(picks: AgentPicks): AgentModelPicks {
  const { main, fast } = picks;
  return { ...(main === undefined ? {} : { main }), ...(fast === undefined ? {} : { fast }) };
}

// The settings with every agent's picks in force.
function settingsWith(
  settings: RuntimeSettings,
  picks: ReadonlyMap<string, AgentModelPicks>,
): RuntimeSettings {
  return { ...settings, models: { ...settings.models, picked: Object.fromEntries(picks) } };
}

/** The agent runtime as the engine holds it. */
export interface ComposedRuntime {
  /** The runtime's running turns, whose marks its proposals take. */
  readonly turns: RunningTurns;
  /** The handlers of the routed operations, which reach the runtime while it runs. */
  readonly handlers: EngineHandlerTable;
  /** The `runtime` health signal. */
  readonly health: () => RuntimeHealth;
  /**
   * Puts an agent's picked models in force: the runtime gets them as new settings, applied from the
   * agent's next turn, and every later start begins with them (decision 0204).
   */
  pick(agent: Id<"agt">, picks: AgentPicks): Promise<void>;
  /**
   * Starts the runtime once the server serves, and adds its closer: the shutdown, which closes the
   * parts last opened first, stops it before every other part.
   */
  begin(server: Pick<ProtocolServer, "endSessions">): void;
}

/** Each agent's picked models as the runtime holds them. */
interface RuntimePicks {
  readonly pick: ComposedRuntime["pick"];
  /** Reads the picks the store kept from before this start and puts them in force; logs a fault. */
  readonly load: () => Promise<void>;
}

function runtimePicksOf(
  opened: Opened,
  supervisor: Pick<RuntimeSupervisor, "apply">,
): RuntimePicks {
  const picks = new Map<string, AgentModelPicks>();
  const apply = async (): Promise<void> => supervisor.apply(settingsWith(opened.runtime, picks));
  const logger = opened.log.logger.child("runtime");
  return {
    async pick(agent, picked) {
      picks.set(agent, runtimePicks(picked));
      await apply();
    },
    async load() {
      try {
        const agents = await opened.stores.agents.list({ signal: new AbortController().signal });
        for (const agent of agents) {
          const kept = runtimePicks(picksOf(agent));
          if (agent.archivedAtMs === undefined && Object.keys(kept).length > 0) {
            picks.set(agent.id, kept);
          }
        }
        if (picks.size > 0) {
          await apply();
        }
      } catch (error) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        logger.warn("runtime.picks_unread", { errorCode });
      }
    },
  };
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
  const picks = runtimePicksOf(opened, supervisor);
  return {
    turns,
    handlers: createRoutedHandlers(
      async (request, signal) => supervisor.route(request, signal),
      turns,
    ),
    health: () => supervisor.health(),
    pick: picks.pick,
    begin(server) {
      ended.endSessions = (credential) => server.endSessions(credential, "auth.revoked");
      supervisor.begin();
      void picks.load();
      closers.add("runtime", async (signal) => supervisor.stop(signal));
    },
  };
}
