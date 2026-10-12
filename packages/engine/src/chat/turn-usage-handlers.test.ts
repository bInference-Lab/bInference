import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";

const runtime = testCallers.runtime;
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const otherAgentClient: EngineCaller = {
  ...runtime,
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000077",
};
const usage = {
  agent: testAgent,
  turn,
  model: "anthropic/claude-sonnet-4-6",
  inputTokens: 12_000,
  outputTokens: 500,
  cachedTokens: 8_000,
  usdMicros: 23_400n,
};
// The test agent's daily model budget, and the test clock's next midnight in Shanghai.
const budget = 5_000_000n;
const shanghai = "Asia/Shanghai";
const nextMidnight = Date.parse("2027-01-15T16:00:00Z");

function notices(test: TestEngine) {
  return test.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
}

// One model call attempt of the turn, under its own key.
async function record(test: TestEngine, n: number, usdMicros = usage.usdMicros) {
  const call = { ...testCall({ ...usage, usdMicros }, runtime), key: `${turn}.usage.${String(n)}` };
  return test.engine.handlers["usage/record"](call);
}

async function startTurn(test: TestEngine) {
  const args = { agent: testAgent, session, turn, messages: [message], outsideContent: false };
  return test.engine.handlers["turn/start"](testCall(args, runtime));
}

describe("the runtime's usage and loop guard in the engine", () => {
  it("charges each model call attempt and answers the budget left", async () => {
    const test = await startTestEngine();
    expect(await record(test, 1)).toStrictEqual({
      ok: true,
      value: { budgetLeftMicros: budget - usage.usdMicros },
    });
    const spent = await test.stores.modelUsage.spent(
      { agent: testAgent, fromMs: 0, toMs: test.clock.now() + 1 },
      { signal: new AbortController().signal },
    );
    expect(spent).toStrictEqual([
      {
        agent: testAgent,
        model: usage.model,
        inputTokens: 12_000,
        outputTokens: 500,
        cachedTokens: 8_000,
        usdMicros: usage.usdMicros,
      },
    ]);
  });

  it("charges an attempt sent again under its key once", async () => {
    const test = await startTestEngine();
    await record(test, 1);
    expect(await record(test, 1)).toStrictEqual({
      ok: true,
      value: { budgetLeftMicros: budget - usage.usdMicros },
    });
  });

  it("refuses usage from any client but the runtime, of an agent it does not hold, or with no key", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    const keyed = { key: `${turn}.usage.1` };
    expect(
      await handlers["usage/record"]({ ...testCall(usage, otherAgentClient), ...keyed }),
    ).toStrictEqual({ ok: false, error: "auth.scope" });
    expect(
      await handlers["usage/record"]({
        ...testCall({ ...usage, agent: stranger }, runtime),
        ...keyed,
      }),
    ).toStrictEqual({ ok: false, error: "agent.not_found" });
    expect(await handlers["usage/record"](testCall(usage, runtime))).toStrictEqual({
      ok: false,
      error: "protocol.key_required",
    });
  });

  it("answers when the budget resumes, and tells the owner once, when a call spends it", async () => {
    const test = await startTestEngine({ timeZone: shanghai });
    const spent = await record(test, 1, budget + 1n);
    await record(test, 2, 10n);

    expect(spent).toStrictEqual({
      ok: true,
      value: { budgetLeftMicros: 0n, resumesAt: nextMidnight },
    });
    expect(notices(test)).toStrictEqual([
      {
        key: "notice.budget",
        agent: testAgent,
        values: { agent: "main", budget: "$5.00" },
        times: { when: nextMidnight },
      },
    ]);
  });

  it("refuses the next turn once the budget is spent, and tells the owner once that day", async () => {
    const test = await startTestEngine({ timeZone: shanghai });
    await record(test, 1, budget);
    const refusals = [startTurn(test), startTurn(test)].map(async (started) =>
      started.then(
        () => undefined,
        (error: unknown) => error,
      ),
    );

    await expect(Promise.all(refusals)).resolves.toMatchObject([
      { code: "agent.budget", details: { resumesAt: nextMidnight } },
      { code: "agent.budget", details: { resumesAt: nextMidnight } },
    ]);
    expect(notices(test)).toHaveLength(1);
    expect(test.turns.runningOf(testAgent)).toBeUndefined();
  });

  it("starts turns again at the owner's midnight, and tells the owner again the next day", async () => {
    const test = await startTestEngine({ timeZone: shanghai });
    await record(test, 1, budget);
    await expect(startTurn(test)).rejects.toMatchObject({ code: "agent.budget" });
    await test.clock.advance(nextMidnight - test.clock.now());

    expect(await startTurn(test)).toStrictEqual({ ok: true, value: { budgetLeftMicros: budget } });
    await record(test, 2, budget);
    expect(notices(test)).toHaveLength(2);
  });

  it("tells the owner when the loop guard ends a turn, and only then", async () => {
    const test = await startTestEngine();
    const status = (statusKey: string) =>
      test.engine.handlers["turn/status"](testCall({ agent: testAgent, turn, statusKey }, runtime));
    await status("turn.toolCallLimit");
    const before = notices(test);
    await status("turn.loop");

    expect(before).toStrictEqual([]);
    expect(notices(test)).toStrictEqual([
      { key: "notice.loop", agent: testAgent, values: { agent: "main" } },
    ]);
  });
});
