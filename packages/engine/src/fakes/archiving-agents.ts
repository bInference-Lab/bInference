import type { AgentStore } from "../ports.js";

/** The agent store, answering the agents in `archived` as archived, for tests of the caps. */
export function archivingAgents(
  agents: Pick<AgentStore, "get">,
  archived: ReadonlySet<string>,
): Pick<AgentStore, "get"> {
  return {
    get: async (id, call) => {
      const settings = await agents.get(id, call);
      return settings === undefined || !archived.has(id)
        ? settings
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  };
}
