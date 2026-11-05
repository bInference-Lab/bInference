import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn } from "./test-turns.js";
import { createTurnFeed } from "./turn-feed.js";

const live = new AbortController().signal;

// An engine whose sends answer at once, or only when the test lets them, noting each in order.
function recordingEngine(options: { readonly fails?: boolean; readonly hangs?: boolean } = {}) {
  const sent: string[] = [];
  const note = async (line: string, signal: AbortSignal): Promise<void> => {
    sent.push(line);
    if (options.fails === true) {
      throw new Error("The engine cannot be reached.");
    }
    if (options.hangs === true) {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    }
  };
  return {
    sent,
    engine: {
      draft: async (text: string, signal: AbortSignal) => note(`draft ${text}`, signal),
      progress: async (tool: string, signal: AbortSignal) => note(`tool ${tool}`, signal),
      reasoning: async (said: { text: string; final: boolean }, signal: AbortSignal) =>
        note(`${said.final ? "thought" : "thinking"} ${said.text}`, signal),
    },
  };
}

describe("a turn's feed", () => {
  it("sends the first draft at once, then the newest at most every 250 ms", async () => {
    const clock = createManualClock(1_000);
    const { sent, engine } = recordingEngine();
    const feed = createTurnFeed({ engine, clock, signal: live });
    feed.text("B");
    await clock.advance(0);
    feed.text("Bu");
    feed.text("Buy");
    await clock.advance(100);
    expect(sent).toStrictEqual(["draft B"]);
    await clock.advance(150);
    feed.text("Buy 1");
    await clock.advance(250);
    expect(sent).toStrictEqual(["draft B", "draft Buy", "draft Buy 1"]);
  });

  it("sends the newest draft written before a tool first, then the tool", async () => {
    const clock = createManualClock(1_000);
    const { sent, engine } = recordingEngine();
    const feed = createTurnFeed({ engine, clock, signal: live });
    feed.text("I");
    feed.text("I check");
    feed.tool("portfolio");
    await clock.advance(300);
    feed.text("You");
    await feed.settle();
    expect(sent).toStrictEqual(["draft I check", "tool portfolio", "draft You"]);
  });

  it("paces the reasoning so far, and a call's whole reasoning replaces one that waits", async () => {
    const clock = createManualClock(1_000);
    const { sent, engine } = recordingEngine();
    const feed = createTurnFeed({ engine, clock, signal: live });
    feed.reasoning("A");
    await clock.advance(0);
    feed.reasoning("AB");
    feed.reasoningEnd("ABC");
    await feed.settle();
    expect(sent).toStrictEqual(["thinking A", "thought ABC"]);
  });

  it("drops a waiting draft and takes nothing once it settled", async () => {
    const clock = createManualClock(1_000);
    const { sent, engine } = recordingEngine();
    const feed = createTurnFeed({ engine, clock, signal: live });
    feed.text("A");
    await clock.advance(0);
    feed.text("A b");
    await feed.settle();
    feed.text("A b c");
    feed.tool("quote");
    await clock.advance(1_000);
    expect(sent).toStrictEqual(["draft A"]);
  });

  it("gives up a send that fails or hangs, and goes on with the next", async () => {
    const clock = createManualClock(1_000);
    const failing = recordingEngine({ fails: true });
    const fails = createTurnFeed({ engine: failing.engine, clock, signal: live });
    fails.tool("quote");
    fails.tool("chart");
    await fails.settle();
    expect(failing.sent).toStrictEqual(["tool quote", "tool chart"]);
    const hanging = recordingEngine({ hangs: true });
    const hangs = createTurnFeed({ engine: hanging.engine, clock, signal: live });
    hangs.tool("quote");
    hangs.tool("chart");
    const settled = hangs.settle();
    await clock.advance(10_000);
    await settled;
    expect(hanging.sent).toStrictEqual(["tool quote", "tool chart"]);
  });
});

// A response whose text comes in three pieces a second apart, as a provider streams it.
function streamed(pieces: readonly string[], clock: ReturnType<typeof createManualClock>) {
  return async function* answer(signal: AbortSignal): AsyncGenerator<ModelEvent> {
    for (const delta of pieces) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces come one after another
      await clock.sleep(1_000, signal);
      yield { type: "text", delta };
    }
    yield {
      type: "done",
      stop: "end",
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    };
  };
}

describe("a turn's drafts and progress lines", () => {
  it("hands the engine the text so far as the model streams it, then the final text", async () => {
    const clock = createManualClock(1_000);
    const { turn, recorder } = createTestTurn({
      clock,
      replies: [streamed(["You ", "hold ", "1 BNB."], clock)],
    });
    const report = turn.run();
    await clock.advance(5_000);
    await expect(report).resolves.toMatchObject({ outcome: "ok" });
    expect(recorder.feed).toStrictEqual([
      { kind: "draft", text: "You " },
      { kind: "draft", text: "You hold " },
      { kind: "draft", text: "You hold 1 BNB." },
    ]);
    expect(recorder.steps.filter(({ kind }) => kind === "say")).toStrictEqual([
      { kind: "say", text: "You hold 1 BNB." },
    ]);
  });

  it("hands the engine the reasoning so far, then each call's whole reasoning before the answer", async () => {
    const clock = createManualClock(1_000);
    async function* answer(signal: AbortSignal): AsyncGenerator<ModelEvent> {
      for (const event of [
        { type: "reasoning", delta: "The owner " },
        { type: "reasoning", delta: "says hey." },
        { type: "text", delta: "<think>Be kind.</think>Hey!" },
      ] as const) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces come one after another
        await clock.sleep(1_000, signal);
        yield event;
      }
      yield {
        type: "done",
        stop: "end",
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      };
    }
    const { turn, recorder } = createTestTurn({ clock, replies: [answer] });
    const report = turn.run();
    await clock.advance(5_000);
    await expect(report).resolves.toMatchObject({ outcome: "ok" });
    expect(recorder.feed).toStrictEqual([
      { kind: "reasoning", text: "The owner ", final: false },
      { kind: "reasoning", text: "The owner says hey.", final: false },
      { kind: "draft", text: "Hey!" },
      { kind: "reasoning", text: "The owner says hey.\n\nBe kind.", final: false },
      { kind: "reasoning", text: "The owner says hey.\n\nBe kind.", final: true },
    ]);
    expect(recorder.steps.filter(({ kind }) => kind === "say")).toStrictEqual([
      { kind: "say", text: "Hey!" },
    ]);
  });

  it("names each tool the turn runs after the text written before it, the answer once", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }], "Let me look."), textReply("You hold 1 BNB.")],
      tools: [{ name: "portfolio", kind: "read" }],
    });
    const report = turn.run();
    await clock.advance(0);
    await expect(report).resolves.toMatchObject({ outcome: "ok" });
    expect(recorder.feed).toStrictEqual([
      { kind: "draft", text: "Let me look." },
      { kind: "progress", tool: "portfolio" },
    ]);
    expect(recorder.steps.filter(({ kind }) => kind === "say")).toStrictEqual([
      { kind: "say", text: "You hold 1 BNB." },
    ]);
  });
});
