import type { Id } from "@binference/core";
import { maxUntakenMessages } from "../chat/agent-inbox-record.js";
import type { AgentInboxStore } from "../chat/ports.js";
import { fixtureId, inOrder, live } from "./store-fixtures.js";

/** Fills the agent's inbox with 200 untaken owner's messages, the most it holds. */
export async function fillAgentInbox(
  agentInbox: AgentInboxStore,
  agent: { readonly agentId: Id<"agt">; readonly session: Id<"ses"> },
): Promise<void> {
  const numbers = Array.from({ length: maxUntakenMessages }, (_, index) => index + 1);
  await inOrder(numbers, async (n) =>
    agentInbox.add(
      {
        id: fixtureId("msg", 1_000 + n),
        agentId: agent.agentId,
        kind: "inbox/message",
        turnId: fixtureId("trn", 1_000 + n),
        payload: { text: "hi", surface: "telegram" },
        atMs: n,
        opens: agent.session,
      },
      live(),
    ),
  );
}
