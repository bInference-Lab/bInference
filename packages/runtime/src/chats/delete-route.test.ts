import { idSchema } from "@binference/core";
import {
  createMemoryAgentDatabase,
  createMemoryChatDeletion,
  createMemorySessionStore,
  createMemoryWriterFence,
} from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import type { RouteLine } from "../control/control-line.schema.js";
import { answerDeleteRoute, type DeleteRouteParts } from "./delete-route.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function route(args: RouteLine["args"]): RouteLine {
  return { t: "route", id: "r1", op: "chat/delete", args, origin: "owner" };
}

// One agent's chat in an in-memory agent database, and the parts that delete it at once.
async function partsWithChat(): Promise<{
  readonly parts: DeleteRouteParts;
  readonly ran: string[];
}> {
  const database = createMemoryAgentDatabase();
  const fence = await createMemoryWriterFence(database).raise(live());
  const draft = { id: session, agentId: agent, surface: "telegram", conversation: "telegram:1" };
  await createMemorySessionStore(database).open({ ...draft, startedAtMs: 1, fence }, live());
  const ran: string[] = [];
  const runner: DeleteRouteParts["runner"] = {
    deleteChats: async (agents, remove) => {
      ran.push(...agents);
      return remove();
    },
  };
  return { parts: { runner, deletion: createMemoryChatDeletion(database), fence }, ran };
}

describe("answerDeleteRoute", () => {
  it("deletes the agents' chats through the chat and answers what went", async () => {
    const { parts, ran } = await partsWithChat();
    const reply = await answerDeleteRoute(route({ agents: [agent] }), parts, live().signal);
    expect(ran).toStrictEqual([agent]);
    expect(reply).toStrictEqual({
      t: "routeReply",
      id: "r1",
      result: {
        sessions: 1,
        turns: 0,
        events: 0,
        messages: 0,
        goals: 0,
        progressNotes: 0,
        helpers: 0,
      },
    });
  });

  it("refuses args that name no agent, before the chat stops anything", async () => {
    const { parts, ran } = await partsWithChat();
    const reply = await answerDeleteRoute(route({ agents: [] }), parts, live().signal);
    expect(reply).toMatchObject({ error: { code: "protocol.bad_args" } });
    expect(ran).toStrictEqual([]);
  });

  it("answers a deletion a later start fenced off as the runtime being away", async () => {
    const { parts } = await partsWithChat();
    const stale = { ...parts, fence: parts.fence + 1 };
    const reply = await answerDeleteRoute(route({ agents: [agent] }), stale, live().signal);
    expect(reply).toMatchObject({ error: { code: "runtime.unavailable" } });
  });
});
