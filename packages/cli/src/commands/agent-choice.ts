import type { ProtocolClient } from "@binference/client";
import type { ProtocolId, ResultOf } from "@binference/protocol";
import type { CliOutput } from "../program/cli-output.js";

// An agent as `engine/status` lists it: its id, its mode and whether it is frozen.
type AgentStatus = ResultOf<"engine/status">["agents"][number];

/** The agent a command acts on, with its status when the engine lists it. */
export interface ChosenAgent {
  readonly agent: ProtocolId<"agent">;
  /** Missing for an agent the engine does not list, which the operation then refuses. */
  readonly status?: AgentStatus;
}

/** What choosing an agent reads and prints through. */
export interface AgentChoiceContext {
  readonly client: ProtocolClient;
  readonly output: CliOutput;
  readonly signal: AbortSignal;
}

/**
 * The agent a command acts on: the one `--agent` names, or the only agent that is not archived.
 * With no agent, or several and none named, it prints why (`cli.no_agent`, `cli.agent_needed`
 * with the ids) and answers `undefined`.
 */
export async function chooseAgent(
  context: AgentChoiceContext,
  named: ProtocolId<"agent"> | undefined,
): Promise<ChosenAgent | undefined> {
  const { client, output, signal } = context;
  const { agents } = await client.call("engine/status", {}, { signal });
  if (named !== undefined) {
    const status = agents.find((agent) => agent.id === named);
    return status === undefined ? { agent: named } : { agent: named, status };
  }
  const [only] = agents;
  if (only !== undefined && agents.length === 1) {
    return { agent: only.id, status: only };
  }
  if (only === undefined) {
    output.fail({ code: "cli.no_agent", key: "agent.none" });
    return undefined;
  }
  const ids = agents.map((agent) => agent.id);
  output.fail({
    code: "cli.agent_needed",
    key: "agent.several",
    values: { count: agents.length, agents: ids.join(", ") },
    details: { agents: ids },
  });
  return undefined;
}
