import type { IntentView, StakeRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import {
  liquidRequest,
  startLiquidEngine,
  testLiquidFake,
  testPoolReceipt,
} from "./test-liquid-stakes.js";
import { testUnbondingSeconds, testValidator } from "./test-stakes.js";

type LiquidTest = Awaited<ReturnType<typeof startLiquidEngine>>;

const units = (base: bigint) => ({ asset: testPoolReceipt, base });

async function propose(test: LiquidTest, request: StakeRequest): Promise<IntentView> {
  return expectOk(await test.engine.handlers["intent/propose"](testCall(request)));
}

async function proposeAuto(test: LiquidTest, request: StakeRequest): Promise<IntentView> {
  const call = testCall(request, testCallers.runtime);
  return expectOk(await test.engine.handlers["intent/propose"](call));
}

async function answerOf(test: LiquidTest, request: StakeRequest): Promise<string> {
  const answer = await test.engine.handlers["intent/propose"](testCall(request));
  return answer.ok ? answer.value.state : answer.error;
}

async function confirm(test: LiquidTest, view: IntentView): Promise<void> {
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("The intent has no card to confirm.");
  }
  const call = { intent: view.intent, card, cardVersion: view.card?.version ?? 1 };
  expectOk(await test.engine.handlers["intent/confirm"](testCall(call)));
}

describe("staking on a liquid pool (decision 0331)", () => {
  it("opens a stake's card that names the pool and the least receipt units, with no validator line", async () => {
    const test = await startLiquidEngine(testLiquidFake());

    const view = await propose(test, liquidRequest("stake"));

    const lines = await testCardText(test, view, "en");
    expect(lines[1]).toBe("Stake 0.5 FAKE with Pool for at least 0.454545 UNL (0x000000e2)");
    expect(lines[2]).toBe("Unstaking later takes 7 days before you can claim it");
    expect(lines.some((line) => line.startsWith("Validator"))).toBe(false);
  });

  it("unstakes receipt units on paper, says the pool's queue may release them later, then claims", async () => {
    const fake = testLiquidFake();
    const test = await startLiquidEngine(fake, { agent: { approvalMode: "auto" } });

    const stake = await proposeAuto(test, liquidRequest("stake"));
    const unstake = await proposeAuto(
      test,
      liquidRequest("unstake", { amount: units(10n ** 17n) }),
    );
    const lines = await testCardText(test, unstake, "en");
    await confirm(test, unstake);
    const early = await proposeAuto(test, liquidRequest("claim"));
    fake.wait(testUnbondingSeconds + 1);
    const claim = await proposeAuto(test, liquidRequest("claim"));

    expect([stake.state, unstake.state]).toStrictEqual(["paper_filled", "awaiting_confirmation"]);
    expect(lines[1]).toBe("Unstake 0.1 UNL (0x000000e2) from Pool");
    expect(lines[2]).toMatch(
      /^Locked while it unbonds: you can claim it from .+, in about 7 days/u,
    );
    expect(lines[3]).toBe(
      "Pool's own queue releases it and may take longer; binference tells you once you can claim it",
    );
    expect([early.state, early.outcome?.reason]).toStrictEqual([
      "failed_check",
      "nothing_to_claim",
    ]);
    expect([claim.state, claim.outcome?.reason]).toStrictEqual(["paper_filled", undefined]);
  });

  it("refuses a validator, an unstake in coin, or a claim with an amount before anything is stored", async () => {
    const test = await startLiquidEngine(testLiquidFake());
    const asks = [
      liquidRequest("stake", { validator: testValidator }),
      liquidRequest("unstake", { amount: { ...units(1n), asset: "fake:1/slip44:1" as never } }),
      liquidRequest("claim", { amount: units(1n) }),
    ];

    const answers = await Promise.all(asks.map(async (request) => answerOf(test, request)));

    expect(answers).toStrictEqual(["protocol.bad_args", "protocol.bad_args", "protocol.bad_args"]);
  });

  it("refuses an unstake of more receipt units than held, and any move while the pool is paused", async () => {
    const fake = testLiquidFake();
    const test = await startLiquidEngine(fake, { agent: { approvalMode: "auto" } });
    await proposeAuto(test, liquidRequest("stake"));

    const over = await propose(test, liquidRequest("unstake", { amount: units(10n ** 18n) }));
    fake.pause();
    const paused = await propose(test, liquidRequest("stake"));

    expect([over.state, over.outcome?.reason]).toStrictEqual(["failed_check", "exceeds_staked"]);
    expect([paused.state, paused.outcome?.reason]).toStrictEqual([
      "failed_check",
      "staking_paused",
    ]);
  });
});
