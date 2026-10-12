import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";

const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const hourMs = 3_600_000;
// The test clock's day in Shanghai starts at 2027-01-14T16:00Z and ends at 2027-01-15T16:00Z.
const dayAt = Date.parse("2027-01-14T16:00:00Z");
const nextDayAt = Date.parse("2027-01-15T16:00:00Z");

let attempts = 0;

// One model call attempt of the runtime, now, on the model given.
async function spend(test: TestEngine, model: string, usdMicros: bigint): Promise<void> {
  attempts += 1;
  const args = {
    agent: testAgent,
    turn,
    model,
    inputTokens: 100,
    outputTokens: 10,
    cachedTokens: 50,
    usdMicros,
  };
  const call = { ...testCall(args, testCallers.runtime), key: `${turn}.usage.${String(attempts)}` };
  await test.engine.handlers["usage/record"](call);
}

const tokens = { inputTokens: 100, outputTokens: 10, cachedTokens: 50 };

describe("usage/get", () => {
  it("answers spend by the owner's day and model, and each agent's budget left", async () => {
    const test = await startTestEngine({ timeZone: "Asia/Shanghai" });
    await spend(test, "openai/gpt-5.4", 1_000n);
    await spend(test, "anthropic/claude-sonnet-4-6", 2_000n);
    await spend(test, "openai/gpt-5.4", 3_000n);
    await test.clock.advance(nextDayAt - test.clock.now());
    await spend(test, "openai/gpt-5.4", 4_000n);
    const args = { from: dayAt + hourMs, to: nextDayAt + hourMs };
    const got = await test.engine.handlers["usage/get"](testCall(args, testCallers.mcp));

    expect(got).toStrictEqual({
      ok: true,
      value: {
        rows: [
          {
            agent: testAgent,
            dayAt,
            model: "anthropic/claude-sonnet-4-6",
            ...tokens,
            usdMicros: 2_000n,
          },
          {
            agent: testAgent,
            dayAt,
            model: "openai/gpt-5.4",
            inputTokens: 200,
            outputTokens: 20,
            cachedTokens: 100,
            usdMicros: 4_000n,
          },
          {
            agent: testAgent,
            dayAt: nextDayAt,
            model: "openai/gpt-5.4",
            ...tokens,
            usdMicros: 4_000n,
          },
        ],
        budgets: [{ agent: testAgent, dailyUsdMicros: 5_000_000n, leftUsdMicros: 4_996_000n }],
      },
    });
  });

  it("cuts the range at its ends", async () => {
    const test = await startTestEngine({ timeZone: "Asia/Shanghai" });
    await spend(test, "openai/gpt-5.4", 1_000n);
    const now = test.clock.now();
    const before = await test.engine.handlers["usage/get"](
      testCall({ agent: testAgent, from: dayAt, to: now }, testCallers.cli),
    );

    expect(before).toMatchObject({ ok: true, value: { rows: [] } });
  });

  it("refuses a range that ends before it starts or spans more than 92 days, and an unknown agent", async () => {
    const test = await startTestEngine();
    const get = test.engine.handlers["usage/get"];
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    const now = test.clock.now();

    expect(await get(testCall({ from: now, to: now }))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(await get(testCall({ from: now - 93 * 24 * hourMs, to: now }))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(await get(testCall({ agent: stranger, from: now - hourMs, to: now }))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
  });
});
