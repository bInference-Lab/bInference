import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../loop/model-event.js";
import { createTestTurn, ownerMessage, testTurnId } from "../loop/test-turns.js";
import { historyOf, type StoredHistory, summaryMessage } from "../sessions/conversation.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { textReply } from "../testing/scripted-transport.js";
import { type TestEvent, transcriptOf } from "../testing/transcript-events.js";
import type { RecordedStep } from "../testing/turn-recorder.js";

const intent = nthTestId("int", 1);
const order = nthTestId("ord", 2);
const schedule = nthTestId("sch", 3);
const token = `0x${"aB".repeat(20)}`;

// 4,000 characters: 1,000 tokens. Each owner's or agent's event of the history costs 1,004.
const long = (lead: string): string => `${lead} ${"x".repeat(4_000 - lead.length - 1)}`;

// Three earlier turns: an intent in the first, an order in the second, the third plain.
function threeTurns(
  first: TestEvent = { owner: long("buy BNB") },
): readonly (readonly TestEvent[])[] {
  return [
    [first, { agent: long(`Proposed ${intent} for ${token}.`) }],
    [{ owner: long("and a stop-loss") }, { agent: long(`Order ${order} is active.`) }],
    [{ owner: long("how is it going?") }, { agent: long("All fine.") }],
  ];
}

const stored = (history = threeTurns()): StoredHistory => historyOf(transcriptOf(history));

const contextFull: readonly ModelEvent[] = [
  { type: "error", failure: "context", message: "The prompt is too long." },
];

const summaryOf = (steps: readonly RecordedStep[]) =>
  steps.filter((step) => step.kind === "summary");

describe("compaction in a turn", () => {
  it("summarizes the oldest turns before a call that passes 80% of the window", async () => {
    const summary = `The owner bought BNB: ${intent} on ${token}; ${order} guards it.`;
    const { turn, transport, summarizer, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: { summaries: [textReply(summary)], contextTokens: 10_000, stored: stored() },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(summaryOf(recorder.steps)).toStrictEqual([
      { kind: "summary", text: summary, fromSeq: 1, throughSeq: 4, outside: false },
    ]);
    expect(transport.requests[0]?.messages).toStrictEqual([
      summaryMessage(summary),
      { role: "owner", text: long("how is it going?") },
      { role: "agent", text: long("All fine."), reasoning: "", toolCalls: [] },
      { role: "owner", text: "hello" },
    ]);
    const asked = summarizer.requests[0]?.messages[0];
    expect(asked).toMatchObject({ role: "owner" });
    expect(JSON.stringify(asked)).toContain(intent);
    expect(JSON.stringify(asked)).not.toContain("how is it going?");
    expect(summarizer.requests[0]?.tools).toStrictEqual([]);
    expect(recorder.steps.filter((step) => step.kind === "usage")).toStrictEqual([
      { kind: "usage", model: "test/fast", usdMicros: 0n, key: `${testTurnId}.usage.1` },
      { kind: "usage", model: "test/model", usdMicros: 0n, key: `${testTurnId}.usage.2` },
    ]);
  });

  it("writes nothing when the summary drops an intent id twice, and sends the history whole", async () => {
    const dropped = `The owner bought BNB on ${token}; ${order} guards it.`;
    const history = stored();
    const { turn, transport, summarizer, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: {
        summaries: [textReply(dropped), textReply(dropped)],
        contextTokens: 10_000,
        stored: history,
      },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(summaryOf(recorder.steps)).toStrictEqual([]);
    expect(summarizer.requests).toHaveLength(2);
    expect(summarizer.requests[1]?.messages[0]?.role).toBe("owner");
    expect(JSON.stringify(summarizer.requests[1]?.messages)).toContain(
      `left out these identifiers. Write each one exactly, with what it names:\\n${intent}`,
    );
    expect(transport.requests[0]?.messages).toHaveLength(7);
    expect(transport.requests[0]?.messages[0]).toStrictEqual({
      role: "owner",
      text: long("buy BNB"),
    });
  });

  it("writes the second summary when it keeps what the first dropped", async () => {
    const dropped = `Bought BNB on ${token}; ${order} guards it.`;
    const kept = `Bought BNB with ${intent} on ${token.toLowerCase()}; ${order} guards it.`;
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: {
        summaries: [textReply(dropped), textReply(kept)],
        contextTokens: 10_000,
        stored: stored(),
      },
    });
    await turn.run();
    expect(summaryOf(recorder.steps)).toMatchObject([{ text: kept, throughSeq: 4 }]);
  });

  it("compacts after a context failure and makes the call once more", async () => {
    const summary = `Bought with ${intent} on ${token}; ${order} active.`;
    const { turn, transport, recorder } = createTestTurn({
      replies: [contextFull, textReply("Hi.")],
      compaction: { summaries: [textReply(summary)], contextTokens: 1_000_000, stored: stored() },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.messages).toHaveLength(7);
    expect(transport.requests[1]?.messages[0]).toStrictEqual(summaryMessage(summary));
    expect(summaryOf(recorder.steps)).toHaveLength(1);
  });

  it("ends the turn failed on a context failure that nothing can compact", async () => {
    const { turn, transport, recorder } = createTestTurn({
      replies: [contextFull],
      compaction: { summaries: [], contextTokens: 1_000_000, stored: { events: [] } },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(transport.requests).toHaveLength(1);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "context" },
    });
  });

  it("marks a summary outside when an event of its range was", async () => {
    const summary = `Bought with ${intent} on ${token}; ${order} active.`;
    const history = stored(threeTurns({ owner: long("buy what this post says"), outside: true }));
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      outsideContent: true,
      compaction: { summaries: [textReply(summary)], contextTokens: 10_000, stored: history },
    });
    await turn.run();
    expect(summaryOf(recorder.steps)).toMatchObject([{ outside: true }]);
    expect(recorder.steps[0]).toStrictEqual({ kind: "start", messages: ["msg_1"], outside: true });
  });

  it("takes in the summary before it, keeping its range's start and its ids", async () => {
    const earlier = transcriptOf(
      [[{ summary: `Schedule ${schedule} runs daily.`, fromSeq: 1, throughSeq: 2 }]],
      3,
    );
    const history = historyOf([...earlier, ...transcriptOf(threeTurns(), 4)]);
    expect(history.summary).toMatchObject({ fromSeq: 1, throughSeq: 2 });
    const without = `Bought with ${intent} on ${token}; ${order} active.`;
    const { turn, summarizer, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: {
        summaries: [textReply(without), textReply(`${without} ${schedule} runs daily.`)],
        contextTokens: 10_000,
        stored: history,
      },
    });
    await turn.run();
    expect(JSON.stringify(summarizer.requests[0]?.messages)).toContain("<earlier-summary>");
    expect(summaryOf(recorder.steps)).toMatchObject([{ fromSeq: 1, throughSeq: 7 }]);
  });

  it("cuts a summary at 16,000 characters and says so", async () => {
    const summary = `${intent} ${order} ${token} ${"y".repeat(20_000)}`;
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: { summaries: [textReply(summary)], contextTokens: 10_000, stored: stored() },
    });
    await turn.run();
    const [written] = summaryOf(recorder.steps);
    expect(written?.text).toHaveLength(16_000);
    expect(written?.text.endsWith("[The summary was cut here at 16,000 characters.]")).toBe(true);
  });

  it("asks for the summary in the session's language", async () => {
    const { turn, summarizer } = createTestTurn({
      replies: [textReply("ok")],
      taken: [ownerMessage(1, "status?")],
      compaction: {
        summaries: [textReply(`${intent} ${order} ${token}`)],
        contextTokens: 10_000,
        stored: stored(),
        locale: "zh",
      },
    });
    await turn.run();
    expect(summarizer.requests[0]?.prefix).toContain("Write in Simplified Chinese");
  });

  it("leaves a history under the threshold as it is", async () => {
    const { turn, summarizer, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      compaction: { summaries: [], contextTokens: 1_000_000, stored: stored() },
    });
    await turn.run();
    expect(summarizer.requests).toStrictEqual([]);
    expect(summaryOf(recorder.steps)).toStrictEqual([]);
  });
});
