import type { JsonValue } from "@binference/core";
import type { EventKind, EventRole, TranscriptEvent } from "@binference/store";
import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { conversationOf, notRunAfterRestart } from "./conversation.js";

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
