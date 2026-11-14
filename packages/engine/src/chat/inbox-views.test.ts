import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import { inboxViewOf } from "./inbox-views.js";

const live = new AbortController().signal;
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const noIntent = async (): Promise<undefined> => Promise.resolve(undefined);

// A stored message of `kind`, with no turn reserved.
function stored(kind: AgentInboxMessage["kind"], payload: AgentInboxMessage["payload"]) {
  return {
    id: message,
    agentId: testAgent,
    sessionId: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    kind,
    payload,
    createdAtMs: testNowMs,
  } satisfies AgentInboxMessage;
}

describe("an inbox message as the runtime reads it", () => {
  it("refuses a message that can start a turn but has none reserved", async () => {
    const owner = stored("inbox/message", { text: "hi", surface: "telegram" });
    await expect(inboxViewOf(owner, noIntent, live)).rejects.toMatchObject({
      code: "engine.inbox_turn_missing",
      details: { message },
    });
  });

  it("refuses a settle message whose intent is not stored", async () => {
    const settled = stored("inbox/intentSettled", { intent });
    await expect(inboxViewOf(settled, noIntent, live)).rejects.toMatchObject({
      code: "engine.intent_missing",
      details: { message, intent },
    });
  });
});
