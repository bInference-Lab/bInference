import { err, type Id } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { AgentDraft } from "../agents/agent-record.js";
import { expectOk, testAgent, testLimits, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall, testCallers } from "./test-engine.js";

const live = { signal: new AbortController().signal };

// The coin sells at $600, so 10^10 base units are worth 6 micro-dollars: two such swaps pass a
// 10 micro-dollar cap together, and either one alone keeps within it.
const sixMicros = testSwap({ amount: { base: 10n ** 10n } });
const capped: Partial<AgentDraft> = {
  limits: { ...testLimits, perTradeUsdMicros: 10n, rollingDayUsdMicros: 10n },
};

async function propose(test: TestEngine, caller = testCallers.cli): Promise<IntentView> {
  return expectOk(await test.engine.handlers["intent/propose"](testCall(sixMicros, caller)));
}

async function confirm(test: TestEngine, view: IntentView) {
  const card = view.card?.card as Id<"crd">;
  const args = { intent: view.intent, card, cardVersion: 1 };
  return test.engine.handlers["intent/confirm"](testCall(args));
}

async function stateOf(test: TestEngine, view: IntentView): Promise<string | undefined> {
  return (await test.stores.intents.get(view.intent, live))?.state;
}

describe("the rolling 24-hour cap at confirmation", () => {
  it("refuses a Confirm past the cap and keeps the card open", async () => {
    const test = await startTestEngine({ agent: capped });
    const [first, second] = [await propose(test), await propose(test)];
    expect(expectOk(await confirm(test, first)).state).toBe("paper_filled");
    expect(await confirm(test, second)).toStrictEqual(err("limit.daily_cap"));
    expect(await stateOf(test, second)).toBe("awaiting_confirmation");
  });

  it("counts a live confirmation from the moment it lands, before anything settles", async () => {
    const test = await startTestEngine({ agent: { ...capped, mode: "live" } });
    const [first, second] = [await propose(test), await propose(test)];
    expect(expectOk(await confirm(test, first)).state).toBe("confirmed");
    expect(test.executor.taken()).toStrictEqual([first.intent]);
    expect(await confirm(test, second)).toStrictEqual(err("limit.daily_cap"));
    expect(test.executor.taken()).toStrictEqual([first.intent]);
  });

  it("lets one of two taps that land together through", async () => {
    const test = await startTestEngine({ agent: capped });
    const [first, second] = [await propose(test), await propose(test)];
    const answers = await Promise.all([confirm(test, first), confirm(test, second)]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toStrictEqual([err("limit.daily_cap")]);
  });

  it("frees the cap once the earlier confirmation is a day old", async () => {
    const test = await startTestEngine({ agent: capped });
    expect(expectOk(await confirm(test, await propose(test))).state).toBe("paper_filled");
    await test.clock.advance(86_400_000);
    const late = await propose(test);
    expect(await confirm(test, late)).toStrictEqual(err("limit.daily_cap"));
    await test.clock.advance(1);
    expect(expectOk(await confirm(test, await propose(test))).state).toBe("paper_filled");
  });

  it("keeps paper and live apart", async () => {
    const test = await startTestEngine({ agent: capped });
    expect(expectOk(await confirm(test, await propose(test))).state).toBe("paper_filled");
    expectOk(await test.engine.handlers["agent/goLive"](testCall({ agent: testAgent })));
    expect(expectOk(await confirm(test, await propose(test))).state).toBe("confirmed");
  });

  it("asks with a card when the auto test finds the day's confirmations fill the cap", async () => {
    const test = await startTestEngine({ agent: { ...capped, approvalMode: "auto" } });
    const runtime = testCallers.runtime;
    expect((await propose(test, runtime)).state).toBe("paper_filled");
    const asked = await propose(test, runtime);
    expect([asked.state, asked.card?.version]).toStrictEqual(["awaiting_confirmation", 1]);
  });
});
