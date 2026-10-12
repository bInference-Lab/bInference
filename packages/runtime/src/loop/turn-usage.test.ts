import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep } from "../testing/turn-recorder.js";
import { builtInPrice } from "../usage/model-price.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn, type TestTool, testTurnId } from "./test-turns.js";

const tokenInfo: TestTool = { name: "token_info", kind: "read" };

// A response that calls `token_info` with the same arguments, under its own call id.
const sameCall = (n: number, args: JsonValue = { chain: "eip155:56", token: "0xabc" }) =>
  callsReply([{ id: `call_${String(n)}`, name: "token_info", args }]);

const kindsOf = (steps: readonly RecordedStep[]) => steps.map((step) => step.kind);

const usageSteps = (steps: readonly RecordedStep[]) =>
  steps.flatMap((step) => (step.kind === "usage" ? [step] : []));

// One Messages answer's usage, as the transport reports it: 12,000 input tokens, 8,000 read from
// the cache and 2,000 written to it, and 500 output tokens.
const cachedUsage = {
  inputTokens: 12_000,
  outputTokens: 500,
  cachedTokens: 8_000,
  cacheWriteTokens: 2_000,
};

function withUsage(
  events: readonly ModelEvent[],
  usage: typeof cachedUsage | (typeof cachedUsage & { usdMicros: bigint }),
) {
  return events.map((event) => (event.type === "done" ? { ...event, usage } : event));
}

const sonnet = "anthropic/claude-sonnet-4-6";

function sonnetPriceOf() {
  const price = builtInPrice("anthropic", "claude-sonnet-4-6");
  if (price === undefined) {
    throw new Error("Expected a built-in price for Claude Sonnet 4.6.");
  }
  return price;
}

const sonnetPrice = sonnetPriceOf();

describe("the usage of a turn's model calls", () => {
  it("records each call's cost with cached tokens before the loop acts on it", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [withUsage(sameCall(1), cachedUsage), withUsage(textReply("Done."), cachedUsage)],
      tools: [tokenInfo],
      model: { name: sonnet, price: sonnetPrice },
    });

    await turn.run();

    // $0.006 plain + $0.0075 written + $0.0024 read + $0.0075 output: $0.0234, worked by hand.
    expect(usageSteps(recorder.steps)).toStrictEqual([
      { kind: "usage", model: sonnet, usdMicros: 23_400n, key: `${testTurnId}.usage.1` },
      { kind: "usage", model: sonnet, usdMicros: 23_400n, key: `${testTurnId}.usage.2` },
    ]);
    expect(kindsOf(recorder.steps).slice(1, 5)).toStrictEqual([
      "usage",
      "response",
      "call",
      "result",
    ]);
  });

  it("records a failed attempt too, then the retry that answered, each under its own key", async () => {
    const overloaded: readonly ModelEvent[] = [
      { type: "error", failure: "transient", message: "Overloaded.", retryAfterMs: 1_000 },
    ];
    const { turn, recorder, clock } = createTestTurn({
      replies: [overloaded, textReply("Done.")],
      model: { name: sonnet, price: sonnetPrice },
    });

    const running = turn.run();
    await clock.advance(1_000);
    await running;

    // The failed attempt reported nothing; the answer's 10 input and 5 output tokens cost
    // 10 x $3 + 5 x $15 per million: $0.000105.
    expect(usageSteps(recorder.steps).map(({ usdMicros, key }) => [usdMicros, key])).toStrictEqual([
      [0n, `${testTurnId}.usage.1`],
      [105n, `${testTurnId}.usage.2`],
    ]);
  });

  it("counts a model with no price as $0, and the provider's own cost when it reports one", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        withUsage(sameCall(1), cachedUsage),
        withUsage(textReply("Done."), { ...cachedUsage, usdMicros: 31_337n }),
      ],
      tools: [tokenInfo],
      model: { name: "local/llama-4" },
    });

    await turn.run();

    expect(usageSteps(recorder.steps).map(({ usdMicros }) => usdMicros)).toStrictEqual([
      0n,
      31_337n,
    ]);
  });

  it("runs the batch of the call that spent the budget, then ends with no model call", async () => {
    const { turn, transport, recorder } = createTestTurn({
      replies: [withUsage(sameCall(1), cachedUsage), textReply("Never asked.")],
      tools: [tokenInfo],
      model: { name: sonnet, price: sonnetPrice },
      recorder: { budgetMicros: 20_000n },
    });

    const report = await turn.run();

    expect(report).toMatchObject({ outcome: "budget", modelCalls: 1 });
    expect(transport.requests).toHaveLength(1);
    expect(recorder.steps.filter((step) => step.kind === "result")).toHaveLength(1);
  });

  it("makes no further call and runs no tool when the engine does not take a record", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [sameCall(1), textReply("Never asked.")],
      tools: [tokenInfo],
      recorder: { failUsage: true },
    });

    const report = await turn.run();

    expect(report).toMatchObject({ outcome: "failed", modelCalls: 1, toolCalls: 0 });
    expect(kindsOf(recorder.steps)).not.toContain("call");
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "engine" },
    });
  });
});
