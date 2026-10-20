import type { StoreHost } from "../tasks/store-host.js";
import {
  type AgentStateCleared,
  clearAgentStateTask,
  clearEngineStateTask,
  type EngineStateCleared,
} from "./reset-tasks.js";

/** What `binference reset` clears from one database, opened with the engine stopped. */
export interface StateReset<Cleared> {
  /** Clears it in one transaction of the database, and answers how many rows went. */
  clear(options: { readonly signal: AbortSignal }): Promise<Cleared>;
}

/** The reset of one open `engine.sqlite`: the agent inbox, the agents' questions and the risk cache. */
export function createEngineStateReset(host: StoreHost): StateReset<EngineStateCleared> {
  return { clear: async (options) => host.run(clearEngineStateTask, null, options) };
}

/** The reset of one open `agent.sqlite`: every chat and note. */
export function createAgentStateReset(host: StoreHost): StateReset<AgentStateCleared> {
  return { clear: async (options) => host.run(clearAgentStateTask, null, options) };
}
