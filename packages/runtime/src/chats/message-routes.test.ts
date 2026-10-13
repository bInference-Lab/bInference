import { idSchema, type JsonValue } from "@binference/core";
import {
  createMemoryAgentDatabase,
  createMemorySessionStore,
  createMemoryTranscriptStore,
  createMemoryWriterFence,
} from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import type { RouteReplyLine } from "../control/control-line.schema.js";
import { answerMessagesRoute, type MessageRouteParts } from "./message-routes.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const otherAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const otherSession = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const live = () => ({ signal: new AbortController().signal });

// One event as the runtime appends it: its role and kind, then its content and time.
function event(
  of: {
    readonly role: "owner" | "agent" | "tool";
    readonly kind: "text" | "tool_call" | "tool_result" | "image";
  },
  content: JsonValue,
  atMs: number,
) {
  return { ...of, content, outside: false, atMs };
}

// A session of the agent with an owner's message, the agent's call and its result, the agent's
// reply and an image, and a session of another agent.
async function transcriptOn(): Promise<MessageRouteParts> {
  const database = createMemoryAgentDatabase();
  const fence = await createMemoryWriterFence(database).raise(live());
  const sessions = createMemorySessionStore(database);
  const transcript = createMemoryTranscriptStore(database);
  const open = { surface: "telegram", conversation: "telegram:1", startedAtMs: 10, fence };
  await sessions.open(
    { id: idSchema("ses").parse(session), agentId: idSchema("agt").parse(agent), ...open },
    live(),
  );
  await sessions.open(
    {
      id: idSchema("ses").parse(otherSession),
      agentId: idSchema("agt").parse(otherAgent),
      ...open,
    },
    live(),
  );
  await transcript.append(
    {
      sessionId: idSchema("ses").parse(session),
      fence,
      events: [
        event({ role: "owner", kind: "text" }, { message: "msg_1", text: "What moved today?" }, 20),
        event(
          { role: "agent", kind: "tool_call" },
          { callId: "c1", name: "portfolio", arguments: "{}" },
          21,
        ),
        event(
          { role: "tool", kind: "tool_result" },
          { callId: "c1", name: "portfolio", text: "1 BNB", isError: false, ran: true },
          22,
        ),
        event({ role: "agent", kind: "text" }, { text: "Your BNB is up 2%.", reasoning: "" }, 23),
        event({ role: "owner", kind: "image" }, { upload: "upload-1" }, 24),
      ],
    },
    live(),
  );
  await transcript.append(
    {
      sessionId: idSchema("ses").parse(otherSession),
      fence,
      events: [
        event({ role: "owner", kind: "text" }, { message: "msg_2", text: "Not yours." }, 30),
      ],
    },
    live(),
  );
  return { sessions, transcript };
}

async function messages(parts: MessageRouteParts, args: JsonValue): Promise<RouteReplyLine> {
  return answerMessagesRoute(
    { t: "route", id: "r1", op: "chat/messages", args, origin: "owner" },
    parts,
    live().signal,
  );
}

describe("the routed chat/messages", () => {
  it("answers the session's messages in order, each with its text", async () => {
    const parts = await transcriptOn();
    await expect(messages(parts, { agent, session })).resolves.toStrictEqual({
      t: "routeReply",
      id: "r1",
      result: {
        items: [
          { session, seq: 1, role: "owner", kind: "text", text: "What moved today?", at: 20 },
          { session, seq: 2, role: "agent", kind: "tool_call", text: "portfolio {}", at: 21 },
          { session, seq: 3, role: "tool", kind: "tool_result", text: "1 BNB", at: 22 },
          { session, seq: 4, role: "agent", kind: "text", text: "Your BNB is up 2%.", at: 23 },
          { session, seq: 5, role: "owner", kind: "image", at: 24 },
        ],
      },
    });
  });

  it("pages by the last message's seq", async () => {
    const parts = await transcriptOn();
    const first = await messages(parts, { agent, session, limit: 2 });
    expect(first).toMatchObject({ result: { items: [{ seq: 1 }, { seq: 2 }], next: "2" } });
    const second = await messages(parts, { agent, session, cursor: "2", limit: 2 });
    expect(second).toMatchObject({ result: { items: [{ seq: 3 }, { seq: 4 }], next: "4" } });
    const last = await messages(parts, { agent, session, cursor: "4", limit: 2 });
    expect(last).toStrictEqual({
      t: "routeReply",
      id: "r1",
      result: { items: [{ session, seq: 5, role: "owner", kind: "image", at: 24 }] },
    });
  });

  it("answers no message for another agent's session, an unknown one, or none named", async () => {
    const parts = await transcriptOn();
    const none = { t: "routeReply", id: "r1", result: { items: [] } };
    await expect(messages(parts, { agent, session: otherSession })).resolves.toStrictEqual(none);
    await expect(
      messages(parts, { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000009" }),
    ).resolves.toStrictEqual(none);
    await expect(messages(parts, { agent })).resolves.toStrictEqual(none);
  });

  it.each([
    ["args that break the schema", { agent: "nobody" }],
    ["a cursor no page gave", { agent, session, cursor: "next" }],
  ])("refuses %s", async (_name, args) => {
    await expect(messages(await transcriptOn(), args)).resolves.toMatchObject({
      t: "routeReply",
      id: "r1",
      error: { code: "protocol.bad_args", retryable: false },
    });
  });
});
