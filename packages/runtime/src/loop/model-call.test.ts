import { createManualClock, type ManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  callsReply,
  createScriptedTransport,
  createTestChain,
  type ScriptedReply,
  type ScriptedTransport,
  textReply,
} from "../testing/scripted-transport.js";
import type { TurnRecorder } from "../testing/turn-recorder.js";
import type { ModelEvent, ModelFailure } from "./model-event.js";
import type { ModelChain } from "./ports.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

const fails = (failure: ModelFailure, retryAfterMs?: number): readonly ModelEvent[] => [
  {
    type: "error",
    failure,
    message: `failed ${failure}`,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  },
];

const portfolio: TestTool = { name: "portfolio", kind: "read" };

function buy(recorder: TurnRecorder): TestTool {
  return {
    name: "buy",
    kind: "propose",
    run: async ({ idempotencyKey }) => {
      recorder.note({ kind: "tool", name: "buy", key: idempotencyKey });
      return { text: "buy waits for the owner's confirmation", isError: false };
    },
  };
}

/** Two scripted models of two providers, and a chain over them that shares `rests`. */
function twoModels(
  first: readonly ScriptedReply[],
  second: readonly ScriptedReply[],
  rests = new Map<string, number>(),
) {
  const a = createScriptedTransport(first);
  const b = createScriptedTransport(second);
  const chainOn = (clock: ManualClock): ModelChain =>
    createTestChain(
      [
        { name: "pa/one", transport: a },
        { name: "pb/two", transport: b },
      ],
      { clock, cooldownMs: 60_000, rests },
    );
  return { a, b, rests, chainOn };
}

function counts(...transports: readonly ScriptedTransport[]): readonly number[] {
  return transports.map((transport) => transport.requests.length);
}

describe("retries and fallbacks of a model call", () => {
  it("waits as long as a 429's Retry-After asks, then calls the same model again", async () => {
    const { turn, transport, clock, recorder } = createTestTurn({
      replies: [fails("transient", 7_000), textReply("Hi.")],
    });
    const running = turn.run();
    await clock.advance(6_999);
    expect(transport.requests).toHaveLength(1);
    await clock.advance(1);
    await expect(running).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(transport.requests).toHaveLength(2);
    expect(recorder.steps).toContainEqual({ kind: "say", text: "Hi." });
  });

  it("waits 1 s then 4 s with no Retry-After, then rests the provider and falls back", async () => {
    const models = twoModels(
      [fails("transient"), fails("transient"), fails("transient")],
      [textReply("From the fallback.")],
    );
    const { turn, clock } = createTestTurn({ replies: [], models: models.chainOn });
    const running = turn.run();
    await clock.advance(999);
    expect(counts(models.a, models.b)).toStrictEqual([1, 0]);
    await clock.advance(1);
    expect(counts(models.a, models.b)).toStrictEqual([2, 0]);
    await clock.advance(3_999);
    expect(counts(models.a, models.b)).toStrictEqual([2, 0]);
    await clock.advance(1);
    await expect(running).resolves.toMatchObject({ outcome: "ok" });
    expect(counts(models.a, models.b)).toStrictEqual([3, 1]);
    expect(models.rests.get("pa")).toBe(1_000 + 5_000 + 60_000);
  });

  it("falls back to the next model before a proposal, and calls no model after one", async () => {
    const models = twoModels([fails("request")], [callsReply([{ id: "p", name: "buy" }])]);
    const { turn, recorder } = createTestTurn({
      replies: [],
      models: models.chainOn,
      tools: (notes) => [buy(notes)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(counts(models.a, models.b)).toStrictEqual([1, 1]);
    expect(recorder.steps).toContainEqual(expect.objectContaining({ kind: "tool", name: "buy" }));
  });

  it("never falls back after a proposal committed the turn", async () => {
    const models = twoModels([callsReply([{ id: "p", name: "buy" }])], [textReply("never")]);
    const { turn } = createTestTurn({
      replies: [],
      models: models.chainOn,
      tools: (notes) => [buy(notes)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(counts(models.a, models.b)).toStrictEqual([1, 0]);
  });

  it("never swaps a chain of one model, as the owner's picked model stands", async () => {
    const { turn, transport, recorder } = createTestTurn({
      replies: [fails("auth"), textReply("never")],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(transport.requests).toHaveLength(1);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "auth" },
    });
  });

  it("keeps the fallback for the rest of the turn, and starts the next turn at the first model", async () => {
    const models = twoModels(
      [fails("request"), textReply("First again.")],
      [callsReply([{ id: "r", name: "portfolio" }]), textReply("Done.")],
    );
    const first = createTestTurn({ replies: [], models: models.chainOn, tools: [portfolio] });
    await expect(first.turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(counts(models.a, models.b)).toStrictEqual([1, 2]);
    const next = createTestTurn({ replies: [], models: models.chainOn });
    await expect(next.turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(counts(models.a, models.b)).toStrictEqual([2, 2]);
  });

  it("skips a resting provider in the next turn until its cooldown ends", async () => {
    const models = twoModels(
      [fails("transient", 70_000), textReply("Rested.")],
      [textReply("Fallback."), textReply("Fallback again.")],
    );
    const first = createTestTurn({ replies: [], models: models.chainOn });
    await expect(first.turn.run()).resolves.toMatchObject({ outcome: "ok" });
    const second = createTestTurn({ replies: [], models: models.chainOn, clock: first.clock });
    await expect(second.turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(counts(models.a, models.b)).toStrictEqual([1, 2]);
    await first.clock.advance(70_000);
    const third = createTestTurn({ replies: [], models: models.chainOn, clock: first.clock });
    await expect(third.turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(counts(models.a, models.b)).toStrictEqual([2, 2]);
  });

  it("makes at most 4 attempts in one call, and ends the turn failed with the last class", async () => {
    const models = twoModels(
      [fails("transient"), fails("transient"), fails("transient")],
      [fails("transient"), textReply("never")],
    );
    const { turn, clock, recorder } = createTestTurn({ replies: [], models: models.chainOn });
    const running = turn.run();
    await clock.advance(5_000);
    await expect(running).resolves.toMatchObject({ outcome: "failed" });
    expect(counts(models.a, models.b)).toStrictEqual([3, 1]);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "transient" },
    });
  });

  it("sends nothing a failed attempt wrote, and keeps only the answer", async () => {
    const { turn, transport, clock, recorder } = createTestTurn({
      replies: [
        [{ type: "text", delta: "Half an ans" }, ...fails("transient", 0)],
        callsReply([{ id: "r", name: "portfolio" }], "Whole."),
        textReply("Done."),
      ],
      tools: [portfolio],
    });
    const running = turn.run();
    await clock.advance(0);
    await expect(running).resolves.toMatchObject({ outcome: "ok" });
    expect(transport.requests[2]?.messages[1]).toMatchObject({ role: "agent", text: "Whole." });
    expect(recorder.steps.filter((step) => step.kind === "response")).toStrictEqual([
      { kind: "response", text: "Whole." },
      { kind: "response", text: "Done." },
    ]);
  });

  it("ends the turn stopped when it is stopped during a wait", async () => {
    const { turn, transport, clock } = createTestTurn({
      replies: [fails("transient", 30_000), textReply("never")],
    });
    const running = turn.run();
    await clock.advance(1_000);
    turn.stop("owner");
    await expect(running).resolves.toMatchObject({ outcome: "stopped" });
    expect(transport.requests).toHaveLength(1);
  });
});

// A stream that says `said`, then sends nothing until its call is stopped.
function stalling(said: readonly ModelEvent[]): ScriptedReply {
  return async function* stall(signal) {
    yield* said;
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    yield { type: "error", failure: "aborted", message: "Stopped." };
  };
}

describe("the idle timeout of a model call", () => {
  it("cuts a stream that goes silent halfway at the idle time, then tries again", async () => {
    const { turn, transport, clock, recorder } = createTestTurn({
      replies: [stalling([{ type: "text", delta: "The pri" }]), textReply("The price is up.")],
      limits: { modelIdleMs: 10_000 },
    });
    const running = turn.run();
    await clock.advance(9_999);
    expect(transport.requests).toHaveLength(1);
    await clock.advance(1);
    await clock.advance(1_000);
    await expect(running).resolves.toMatchObject({ outcome: "ok" });
    expect(transport.requests).toHaveLength(2);
    expect(recorder.steps).toContainEqual({ kind: "say", text: "The price is up." });
  });

  it("counts the silence from the call's start when no event comes at all", async () => {
    const { turn, clock, recorder } = createTestTurn({
      replies: [stalling([]), stalling([]), stalling([])],
      limits: { modelIdleMs: 10_000 },
    });
    const running = turn.run();
    await clock.advance(10_000 + 1_000 + 10_000 + 4_000 + 10_000);
    await expect(running).resolves.toMatchObject({ outcome: "failed" });
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "transient" },
    });
  });

  it("lets a stream run past the idle time while each event comes within it", async () => {
    const clock = createManualClock(1_000);
    const slow: ScriptedReply = async function* slowly(signal) {
      for (const piece of ["Slow", " but", " sure."]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each piece follows the one before
        await clock.sleep(6_000, signal);
        yield { type: "text", delta: piece };
      }
      yield {
        type: "done",
        stop: "end",
        usage: { inputTokens: 1, outputTokens: 3, cachedTokens: 0 },
      };
    };
    const { turn, transport } = createTestTurn({
      replies: [slow],
      limits: { modelIdleMs: 10_000 },
      clock,
    });
    const running = turn.run();
    await clock.advance(18_000);
    await expect(running).resolves.toMatchObject({ outcome: "ok" });
    expect(transport.requests).toHaveLength(1);
  });
});
