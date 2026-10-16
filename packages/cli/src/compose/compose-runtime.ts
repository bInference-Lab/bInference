import { BinferenceError, type Id, idSchema } from "@binference/core";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { AgentModelPicks, RuntimeModels, RuntimeSettings } from "@binference/runtime";
import type { ProtocolServer } from "@binference/server";
import { createRoutedHandlers } from "../agent-runtime/routed-handlers.js";
import { runtimeKeys, runtimeSettingsOf } from "../agent-runtime/runtime-settings-of.js";
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

// The models the owner picked for the agent, by role.
function runtimePicks(picks: AgentPicks): AgentModelPicks {
  const { main, fast, vision } = picks;
  return {
    ...(main === undefined ? {} : { main }),
    ...(fast === undefined ? {} : { fast }),
    ...(vision === undefined ? {} : { vision }),
  };
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
  /** The models the runtime runs with now: the config's, keys resolved. */
  models(): RuntimeModels;
  /**
   * Follows a reload of `config.json5` (decision 0230): when a changed key is one the runtime's
   * settings hold, reads them again from the config cell, provider and search keys from their
   * secret sources, and sends them to the runtime, which applies them from its next model call.
   */
  followReload(changed: readonly string[], signal: AbortSignal): Promise<void>;
  /**
   * Starts the runtime once the server serves, and adds its closer: the shutdown, which closes the
   * parts last opened first, stops it before every other part.
   */
  begin(server: Pick<ProtocolServer, "endSessions">): void;
}

/** The runtime's settings as the engine holds them: the config's, with each agent's picks. */
interface HeldSettings {
  readonly pick: ComposedRuntime["pick"];
  readonly models: ComposedRuntime["models"];
  /** Puts settings read again from the config in force, with the picks kept. */
  readonly follow: (settings: RuntimeSettings) => Promise<void>;
  /** Reads the picks the store kept from before this start and puts them in force; logs a fault. */
  readonly load: () => Promise<void>;
}

function heldSettingsOf(
  opened: Opened,
  supervisor: Pick<RuntimeSupervisor, "apply">,
): HeldSettings {
  const picks = new Map<string, AgentModelPicks>();
  const state = { config: opened.runtime };
  const apply = async (): Promise<void> => supervisor.apply(settingsWith(state.config, picks));
  const logger = opened.log.logger.child("runtime");
  return {
    async pick(agent, picked) {
      picks.set(agent, runtimePicks(picked));
      await apply();
    },
    models: () => state.config.models,
    async follow(settings) {
      state.config = settings;
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

const isRuntimeKey = (path: string): boolean =>
  runtimeKeys.some((key) => path === key || path.startsWith(`${key}.`));

function followReloadOf(opened: Opened, held: HeldSettings): ComposedRuntime["followReload"] {
  return async (changed, signal) => {
    if (!changed.some(isRuntimeKey)) {
      return;
    }
    const logger = opened.log.logger.child("runtime");
    const call = { secrets: opened.secrets, logger, signal };
    await held.follow(await runtimeSettingsOf(opened.settings.current(), call));
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
  const held = heldSettingsOf(opened, supervisor);
  return {
    turns,
    handlers: createRoutedHandlers(
      async (request, signal) => supervisor.route(request, signal),
      turns,
      async (agent, signal) =>
        opened.stores.agentInbox.openSession(idSchema("agt").parse(agent), { signal }),
    ),
    health: () => supervisor.health(),
    pick: held.pick,
    models: held.models,
    followReload: followReloadOf(opened, held),
    begin(server) {
      ended.endSessions = (credential) => server.endSessions(credential, "auth.revoked");
      supervisor.begin();
      void held.load();
      closers.add("runtime", async (signal) => supervisor.stop(signal));
    },
  };
}
