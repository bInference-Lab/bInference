import type { AgentView } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";

/** An agent as the protocol shows it. */
export function agentViewOf(agent: AgentRecord): AgentView {
  return {
    agent: agent.id,
    name: agent.name,
    mode: agent.mode,
    locale: agent.locale,
    ...(agent.frozenAtMs === undefined ? {} : { frozenAt: agent.frozenAtMs }),
    ...(agent.archivedAtMs === undefined ? {} : { archivedAt: agent.archivedAtMs }),
    createdAt: agent.createdAtMs,
    changedAt: agent.changedAtMs,
  };
}
