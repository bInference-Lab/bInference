import type { JsonValue } from "@binference/core";
import type { EventKind, EventRole, TranscriptEvent } from "@binference/store";
import { describe, expect, it } from "vitest";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { transcriptOf } from "../testing/transcript-events.js";
import {
  conversationOf,
  historyOf,
  loadConversation,
  notRunAfterRestart,
  summaryMessage,
} from "./conversation.js";

function eventsOf(
  drafts: readonly (readonly [EventRole, EventKind, JsonValue])[],
): readonly TranscriptEvent[] {
  return drafts.map(([role, kind, content], index) => ({
    id: index + 1,
    sessionId: nthTestId("ses", 1),
    turnId: nthTestId("trn", 1),
    seq: index + 1,
    role,
    kind,
    content,
    outside: false,
    atMs: index,
  }));
}

const owner = (text: string) => ["owner", "text", { message: "msg_1", text }] as const;
const response = (text: string) => ["agent", "text", { text, reasoning: "" }] as const;
const call = (callId: string, args = "{}") =>
  ["agent", "tool_call", { callId, name: "quote", arguments: args }] as const;
const result = (callId: string, text: string) =>
  ["tool", "tool_result", { callId, name: "quote", text, isError: false, ran: true }] as const;
const toolEntry = (callId: string, text: string, isError = false) => ({
  role: "tool",
  callId,
  name: "quote",
  text,
  isError,
});

describe("conversationOf", () => {
  it("follows each response with its calls' results in the calls' order", () => {
    const events = eventsOf([
      owner("price?"),
      response("Looking"),
      call("c1"),
      result("c1", "1 BNB"),
      call("c2"),
      result("c2", "2 BNB"),
      response("Done"),
    ]);
    expect(conversationOf(events)).toStrictEqual([
      { role: "owner", text: "price?" },
      {
        role: "agent",
        text: "Looking",
        reasoning: "",
        toolCalls: [
          { id: "c1", name: "quote", argumentsText: "{}" },
          { id: "c2", name: "quote", argumentsText: "{}" },
        ],
      },
      toolEntry("c1", "1 BNB"),
      toolEntry("c2", "2 BNB"),
      { role: "agent", text: "Done", reasoning: "", toolCalls: [] },
    ]);
  });

  it("answers a call with no result as not run after a restart", () => {
    const events = eventsOf([response("Looking"), call("c1"), result("c1", "1"), call("c2")]);
    expect(conversationOf(events).slice(1)).toStrictEqual([
      toolEntry("c1", "1"),
      toolEntry("c2", notRunAfterRestart, true),
    ]);
  });

  it("leaves out a second result of a call and a result with no call", () => {
    const events = eventsOf([
      result("c0", "stray"),
      response("Looking"),
      call("c1"),
      result("c1", "first"),
      result("c1", "second"),
      result("c9", "unknown"),
    ]);
    expect(conversationOf(events).slice(1)).toStrictEqual([toolEntry("c1", "first")]);
  });

  it("moves an owner message stored before a call's result after the results", () => {
    const events = eventsOf([response("Looking"), call("c1"), owner("and BNB"), result("c1", "1")]);
    expect(conversationOf(events).slice(1)).toStrictEqual([
      toolEntry("c1", "1"),
      { role: "owner", text: "and BNB" },
    ]);
  });

  it("sends arguments that are not a JSON object back as an empty object", () => {
    const events = eventsOf([
      response(""),
      call("c1", '{"amount":'),
      call("c2", "[1]"),
      call("c3", '{"amount":"1"}'),
    ]);
    expect(conversationOf(events)[0]).toMatchObject({
      toolCalls: [
        { argumentsText: "{}" },
        { argumentsText: "{}" },
        { argumentsText: '{"amount":"1"}' },
      ],
    });
  });
});

describe("historyOf", () => {
  const events = transcriptOf([
    [{ owner: "buy BNB", outside: true }, { agent: "Proposed." }],
    [{ owner: "and a stop-loss" }, { agent: "Set." }],
    [{ summary: "Old summary.", fromSeq: 1, throughSeq: 1 }],
    [{ summary: "The owner bought BNB.", fromSeq: 1, throughSeq: 2 }],
    [{ owner: "status?" }],
  ]);

  it("starts at the latest summary and leaves out the events of its range", () => {
    const history = historyOf(events);
    expect(history.summary).toStrictEqual({
      text: "The owner bought BNB.",
      fromSeq: 1,
      throughSeq: 2,
      outside: false,
    });
    expect(history.events.map((event) => event.seq)).toStrictEqual([3, 4, 7]);
  });

  it("loads the summary as the conversation's first message, marked as a record", async () => {
    const { stores } = await createMemoryAgentStores();
    const signal = new AbortController().signal;
    const session = nthTestId("ses", 1);
    const memory = await loadConversation(
      { ...stores.transcript, events: async () => events },
      session,
      signal,
    );
    expect(memory.messages[0]).toStrictEqual(summaryMessage("The owner bought BNB."));
    expect(JSON.stringify(memory.messages[0])).toContain("not the owner's words");
    expect(memory.messages.slice(1)).toStrictEqual([
      { role: "owner", text: "and a stop-loss" },
      { role: "agent", text: "Set.", reasoning: "", toolCalls: [] },
      { role: "owner", text: "status?" },
    ]);
    expect(memory.outside).toBe(false);
  });

  it("holds outside content when the summary is marked", () => {
    const marked = transcriptOf([
      [{ owner: "read this post" }],
      [{ summary: "The owner shared a post.", fromSeq: 1, throughSeq: 1, outside: true }],
    ]);
    expect(historyOf(marked).summary?.outside).toBe(true);
  });
});
