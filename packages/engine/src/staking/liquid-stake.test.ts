import type { IntentView, StakeRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testWallet } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import {
  liquidCardLines,
  liquidRequest,
  liquidWordsOf,
  refusedBeforePlan,
  startLiquidEngine,
  testLiquidFake,
  testPool,
  testPoolReceipt,
} from "./test-liquid-stakes.js";
import {
  halfCoin,
  holdStakeWallet,
  testUnbondingSeconds,
  testValidator,
  withOwnCap,
} from "./test-stakes.js";

type LiquidTest = Awaited<ReturnType<typeof startLiquidEngine>>;

const units = (base: bigint) => ({ asset: testPoolReceipt, base });

// The fake pool, its deposit declared with a cap of its own, as Lista's is (decision 0332).
const cappedPool = () => withOwnCap(testLiquidFake(), { contract: "pool", name: "deposit" });

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

const refused = String.fromCodePoint(0x274c);
async function confirm(test: LiquidTest, view: IntentView): Promise<void> {
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("The intent has no card to confirm.");
  }
  const call = { intent: view.intent, card, cardVersion: view.card?.version ?? 1 };
  expectOk(await test.engine.handlers["intent/confirm"](testCall(call)));
}

describe("staking on a liquid pool (decision 0331)", () => {
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

  it("refuses a stake above what an old ceiling lets one deposit carry, and names how to rewrite it", async () => {
    const test = await startLiquidEngine(cappedPool());
    const later = await startLiquidEngine(cappedPool());
    holdStakeWallet(test);
    holdStakeWallet(later, [{ functionName: "deposit", maxValueBase: 100n * 10n ** 18n }]);
    const request = liquidRequest("stake", { amount: { ...halfCoin, base: 15n * 10n ** 17n } });

    const old = await propose(test, request);
    const rewritten = await propose(later, request);

    expect([old.state, old.outcome?.reason]).toStrictEqual(["failed_check", "stake_over_ceiling"]);
    expect(liquidWordsOf(old, "en")).toContain(
      `\`binference ceiling set --wallet ${testWallet} --venues VENUES\``,
    );
    expect(rewritten.state).toBe("awaiting_confirmation");
  });

  it("marks the pool in the staking options, which a request on it never names", async () => {
    const fake = testLiquidFake();
    const test = await startLiquidEngine(fake);
    const read = await test.engine.handlers["staking/options"](testCall({ chain: fake.chain }));

    expect(expectOk(read).items).toMatchObject([
      { venue: "fake-liquid", validator: fake.pool, pool: true, name: "Pool" },
    ]);
  });

  it("refuses a validator, an unstake in coin, or a claim with an amount before anything is stored", async () => {
    const fake = testLiquidFake();
    const test = await startLiquidEngine(fake);
    const asks = [
      liquidRequest("stake", { validator: testValidator }),
      liquidRequest("claim", { validator: fake.pool }),
      liquidRequest("unstake", { amount: { ...units(1n), asset: "fake:1/slip44:1" as never } }),
      liquidRequest("claim", { amount: units(1n) }),
    ];

    const answers = await Promise.all(asks.map(async (request) => answerOf(test, request)));

    expect(answers).toStrictEqual([
      "intent.pool_venue",
      "intent.pool_venue",
      "intent.pool_venue",
      "protocol.bad_args",
    ]);
  });

  it("draws a stake's, an unstake's and a claim's cards with the pool's name and no validator", async () => {
    const cards = await liquidCardLines("en");
    const [stake, unstake, claim] = cards;

    expect(stake?.slice(1, 3)).toStrictEqual([
      "Stake 0.5 FAKE with Pool for at least 0.454545 UNL (0x000000e2)",
      "Unstaking later takes 7 days before you can claim it",
    ]);
    expect(unstake?.[1]).toBe("Unstake 0.1 UNL (0x000000e2) from Pool");
    expect(unstake?.[3]).toBe(
      "Pool's own queue releases it and may take longer; binference tells you once you can claim it",
    );
    expect(claim?.[1]).toBe("Claim 0.11 FAKE from your Pool unstake");
    expect(cards.flat().some((line) => line.startsWith("Validator"))).toBe(false);
  });

  it("names the pool by its name in the words of a refusal before any plan", async () => {
    const views = await refusedBeforePlan();

    expect(views.map((view) => view.outcome?.reason)).toStrictEqual([
      "nothing_staked",
      "exceeds_staked",
    ]);
    expect(views.map((view) => view.outcome?.validator)).toStrictEqual([testPool, testPool]);
    expect(views.map((view) => liquidWordsOf(view, "en"))).toStrictEqual([
      `${refused} Not sent: this wallet has nothing staked with Pool (0x000000e1)`,
      `${refused} Not sent: that is more than this wallet's stake with Pool (0x000000e1) is worth; unstake all of it, or less`,
    ]);
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

describe("a liquid pool that cannot answer", () => {
  it("refuses an unstake before anything is stored while the pool cannot name its receipt token", async () => {
    const venue = { ...testLiquidFake(), receipt: async () => Promise.reject(new Error("down")) };
    const test = await startLiquidEngine(venue);

    expect(await answerOf(test, liquidRequest("unstake", { amount: units(1n) }))).toBe(
      "quote.venue_down",
    );
  });

  it("names the pool by its account alone in a refusal while its options cannot be read", async () => {
    const venue = { ...testLiquidFake(), options: async () => Promise.reject(new Error("down")) };
    const test = await startLiquidEngine(venue);

    const view = await propose(test, liquidRequest("unstake", { amount: units(10n ** 17n) }));

    expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", "nothing_staked"]);
    expect(view.outcome?.validator).toStrictEqual({ account: testPool.account });
  });
});
