import type { ProtocolErrorCode } from "@binference/protocol";
import type { ProposalProblem } from "../intents/state-machine.js";

const codes: Readonly<Record<ProposalProblem, ProtocolErrorCode>> = {
  agent_missing: "agent.not_found",
  agent_archived: "agent.archived",
  wrong_proposer: "auth.scope",
};

/** The protocol error a proposal answers when the intent machine refuses to open it. */
export function proposalProblemCode(problem: ProposalProblem): ProtocolErrorCode {
  return codes[problem];
}
