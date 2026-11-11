import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Id } from "@binference/core";
import { type SkillProposalView, skillProposalLimits } from "@binference/protocol";
import type { ContextSource } from "./ports.js";

// The agent's pending proposals, then the five it decided last; none from an engine without them.
async function skillProposalsOf(
  client: Pick<ProtocolClient, "call">,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<readonly SkillProposalView[]> {
  try {
    const pending = await client.call(
      "skillProposal/list",
      { agent, status: "pending", limit: skillProposalLimits.pendingPerAgent },
      { signal },
    );
    const latest = await client.call("skillProposal/list", { agent, limit: 25 }, { signal });
    const decided = latest.items.filter(({ status }) => status !== "pending").slice(0, 5);
    return [...pending.items, ...decided];
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "protocol.unknown_op") {
      return [];
    }
    throw error;
  }
}

/**
 * The {@link ContextSource} over the runtime's protocol client: `agent/readFile`, whose
 * `agent.file_missing` is a file the agent does not have; `skill/list` for the agent, where an
 * engine that does not serve it lists no skill, a waiting one marked `held`; `facts/get`; and
 * `skillProposal/list`, its pending proposals and the five it decided last (decision 0408). Any
 * other failure rejects.
 */
export function createProtocolContextSource(client: Pick<ProtocolClient, "call">): ContextSource {
  return {
    async workspaceFile(place, signal) {
      try {
        const read = await client.call("agent/readFile", { ...place }, { signal });
        return read.text;
      } catch (error) {
        if (error instanceof BinferenceError && error.code === "agent.file_missing") {
          return undefined;
        }
        throw error;
      }
    },
    async skills(agent, signal) {
      try {
        const page = await client.call("skill/list", { agent }, { signal });
        return page.items.flatMap(({ name, description, location, held }) => {
          if (description === undefined || location === undefined) {
            return [];
          }
          return held === true
            ? [{ name, description, location, held }]
            : [{ name, description, location }];
        });
      } catch (error) {
        if (error instanceof BinferenceError && error.code === "protocol.unknown_op") {
          return [];
        }
        throw error;
      }
    },
    async liveFacts(agent, signal) {
      return client.call("facts/get", { agent }, { signal });
    },
    skillProposals: async (agent, signal) => skillProposalsOf(client, agent, signal),
  };
}
