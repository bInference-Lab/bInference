import type { AgentSettings } from "../agents/agent-record.js";
import type { AgentStatus } from "../intents/state-machine.js";

/** The status a proposal's agent has for the state machine: missing, archived, or active. */
export function agentStatusOf(settings: AgentSettings | undefined): AgentStatus {
  if (settings === undefined) {
    return "missing";
  }
  return settings.agent.archivedAtMs === undefined ? "active" : "archived";
}
