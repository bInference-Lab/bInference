import { assetRefSchema } from "@binference/chain";
import type { IntentView, StakeRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeTokenFacts, fakeTokenFacts } from "../fakes/fake-token-facts.js";
import { expectOk, testCoin } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import {
  halfCoin,
  holdStakeWallet,
  jailedValidator,
  stakeRequest,
  startStakeEngine,
  testStakingFake,
  testUnbondingSeconds,
  withOwnCap,
} from "./test-stakes.js";

const live = { signal: new AbortController().signal };
const oneCoin = 10n ** 18n;

type StakeTest = Awaited<ReturnType<typeof startStakeEngine>>;

async function propose(
  test: Awaited<ReturnType<typeof startStakeEngine>>,
  request = stakeRequest("stake"),
) {
  return expectOk(await test.engine.handlers["intent/propose"](testCall(request)));
}

// What a proposal answered: the intent's state, or the protocol error that stored nothing.
async function answerOf(test: StakeTest, request: Readonly<StakeRequest>): Promise<string> {
  const answer = await test.engine.handlers["intent/propose"](testCall(request));
  return answer.ok ? answer.value.state : answer.error;
}

// The owner's tap on the intent's card.
async function confirm(test: StakeTest, view: IntentView): Promise<void> {
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("The intent has no card to confirm.");
  }
  const call = { intent: view.intent, card, cardVersion: view.card?.version ?? 1 };
  expectOk(await test.engine.handlers["intent/confirm"](testCall(call)));
}

// An unstake of the whole stake: it names no amount.
function wholeUnstake(): StakeRequest {
  const { amount: _amount, ...whole } = stakeRequest("unstake");
  return whole;
}

describe("proposing a stake", () => {
  it("opens a card with the validator, its commission and yearly rate, and the days an unstake waits", async () => {
    const test = await startStakeEngine(withOwnCap(testStakingFake()));

    const view = await propose(test);

    expect(view).toMatchObject({ kind: "stake", state: "awaiting_confirmation" });
    expect((await testCardText(test, view, "en")).slice(1, 5)).toStrictEqual([
      "Stake 0.5 FAKE with Active (0x000000c1)",
      "Validator Active (0x000000c1) · commission 7.00%",
      "Yearly rate 3.50%, from its last day of rewards",
      "Unstaking later takes 7 days before you can claim it",
    ]);
  });

  it("says on an unstake's card when its funds can be claimed, and not sooner", async () => {
    const fake = testStakingFake();
    const test = await startStakeEngine(fake);
    const staked = await propose(test);
    await confirm(test, staked);

    const view = await propose(
      test,
      stakeRequest("unstake", { amount: { asset: testCoin, base: oneCoin / 4n } }),
    );

    const lines = await testCardText(test, view, "en");
    expect(lines.slice(1, 3)).toStrictEqual([
      "Unstake 0.25 FAKE from Active (0x000000c1) · ready in 7 days",
      "Validator Active (0x000000c1) · commission 7.00%",
    ]);
    expect(lines[3]).toMatch(
      /^Locked while it unbonds: you can claim it from .+, in about 7 days, and not sooner$/u,
    );
  });

  it("refuses a claim with nothing ready before any card", async () => {
    const test = await startStakeEngine(testStakingFake());

    const view = await propose(test, stakeRequest("claim"));

    expect([view.state, view.outcome?.reason, view.card]).toStrictEqual([
      "failed_check",
      "nothing_to_claim",
      undefined,
    ]);
  });

  it("refuses a stake to a jailed validator by the policy, and a small one by the venue", async () => {
    const test = await startStakeEngine(testStakingFake());

    const jailed = await propose(test, stakeRequest("stake", { validator: jailedValidator }));
    const small = await propose(
      test,
      stakeRequest("stake", { amount: { asset: testCoin, base: 1n } }),
    );

    expect([jailed.state, jailed.outcome?.reason]).toStrictEqual([
      "rejected_policy",
      "validator_jailed",
    ]);
    expect([small.state, small.outcome?.reason]).toStrictEqual(["failed_check", "below_min_stake"]);
  });

  it("counts a stake against the per-trade cap and never an unstake", async () => {
    const test = await startStakeEngine(testStakingFake());
    const big = { asset: testCoin, base: 2n * oneCoin };

    const stake = await propose(test, stakeRequest("stake", { amount: big }));
    const unstake = await propose(test, stakeRequest("unstake", { amount: big }));

    expect([stake.state, stake.outcome?.reason]).toStrictEqual([
      "rejected_policy",
      "per_trade_cap",
    ]);
    expect([unstake.state, unstake.outcome?.reason]).toStrictEqual([
      "failed_check",
      "nothing_staked",
    ]);
  });

  it("refuses a stake above what an old ceiling lets one stake carry, and names how to rewrite it", async () => {
    const test = await startStakeEngine(withOwnCap(testStakingFake()));
    const later = await startStakeEngine(withOwnCap(testStakingFake()));
    holdStakeWallet(test);
    holdStakeWallet(later, [{ functionName: "delegate", maxValueBase: 100n * oneCoin }]);
    const request = stakeRequest("stake", {
      amount: { asset: testCoin, base: (3n * oneCoin) / 2n },
    });

    const old = await propose(test, request);
    const rewritten = await propose(later, request);

    expect([old.state, old.outcome?.reason]).toStrictEqual(["failed_check", "stake_over_ceiling"]);
    expect(rewritten.state).toBe("awaiting_confirmation");
  });

  it("keeps what a stake's receipt token says of itself for its receipt, and reads none for a claim", async () => {
    const facts = createFakeTokenFacts();
    const test = await startStakeEngine(testStakingFake(), { tokenFacts: facts.read });
    const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");

    await propose(test);
    await propose(test, stakeRequest("claim"));

    expect(await test.stores.intents.storedAssets([receipt], live)).toStrictEqual({
      [receipt]: { ...fakeTokenFacts, verified: false },
    });
    expect(facts.reads()).toStrictEqual([[receipt]]);
  });

  it("stores nothing for a stake whose receipt token answers no symbol or decimals", async () => {
    const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
    const facts = createFakeTokenFacts({ unreadable: [receipt] });
    const test = await startStakeEngine(testStakingFake(), { tokenFacts: facts.read });

    expect(await answerOf(test, stakeRequest("stake"))).toBe("asset.unreadable");
    const listed = expectOk(await test.engine.handlers["intent/list"](testCall({})));
    expect(listed.items).toStrictEqual([]);
  });

  it("refuses a request of no validator, another venue, another asset or a claim with an amount", async () => {
    const test = await startStakeEngine(testStakingFake());
    const asks = [
      stakeRequest("stake", { venue: "elsewhere" }),
      stakeRequest("claim", { amount: halfCoin }),
      stakeRequest("stake", { amount: { asset: "fake:1/token:0x0000000a" as never, base: 1n } }),
    ];
    const { validator: _validator, ...noValidator } = stakeRequest("stake");

    const answers = await Promise.all(
      [...asks, noValidator].map(async (request: Readonly<StakeRequest>) =>
        answerOf(test, request),
      ),
    );

    expect(answers).toStrictEqual([
      "protocol.bad_args",
      "protocol.bad_args",
      "protocol.bad_args",
      "protocol.bad_args",
    ]);
  });
});

describe("staking in auto mode", () => {
  it("opens a card for a stake while a community plugin is on, and says why (decision 0350)", async () => {
    const test = await startStakeEngine(withOwnCap(testStakingFake()), {
      agent: { approvalMode: "auto" },
      communityPluginsOn: () => true,
    });
    const request = testCall(stakeRequest("stake"), testCallers.runtime);
    const view = expectOk(await test.engine.handlers["intent/propose"](request));

    expect(view.state).toBe("awaiting_confirmation");
    expect(await testCardText(test, view, "en")).toContain(
      "Auto mode asks you here: a community plugin is on, and its words reach every turn",
    );
  });
});

describe("staking on paper", () => {
  it("stakes, waits out the unbonding, then claims the coin back into the paper portfolio", async () => {
    const fake = testStakingFake();
    const test = await startStakeEngine(fake, { agent: { approvalMode: "auto" } });
    const runtime = testCallers.runtime;
    const proposeAuto = async (request: ReturnType<typeof stakeRequest>) =>
      expectOk(await test.engine.handlers["intent/propose"](testCall(request, runtime)));

    const stake = await proposeAuto(stakeRequest("stake"));
    const unstake = await proposeAuto(wholeUnstake());
    expect([stake.state, unstake.state]).toStrictEqual(["paper_filled", "awaiting_confirmation"]);
    await confirm(test, unstake);
    const early = await proposeAuto(stakeRequest("claim"));
    fake.wait(testUnbondingSeconds + 1);
    const claim = await proposeAuto(stakeRequest("claim"));

    expect([early.state, early.outcome?.reason]).toStrictEqual([
      "failed_check",
      "nothing_to_claim",
    ]);
    expect(claim.state).toBe("paper_filled");
    const positions = await test.positions.positions(
      { walletId: stake.wallet, isPaper: true },
      live,
    );
    expect(positions.find((position) => position.asset === testCoin)?.quantityBase).toBe(
      5n * oneCoin,
    );
  });
});
