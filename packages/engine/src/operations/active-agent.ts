import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { AgentStore } from "../ports.js";

/**
 * The agent a call names with its settings, while it exists and is not archived: an unknown
 * agent is `agent.not_found`, an archived one `agent.archived`.
 */
export async function activeAgent(
  agents: AgentStore,
  agent: Id<"agt">,
  options: { readonly signal: AbortSignal },
): Promise<Result<AgentSettings, ProtocolErrorCode>> {
  const settings = await agents.get(agent, options);
  if (settings === undefined) {
    return err("agent.not_found");
  }
  return settings.agent.archivedAtMs === undefined ? ok(settings) : err("agent.archived");
}
