import { accountRefSchema, assetRefSchema, type PriceSource } from "@binference/chain";
import type { StakePlan, StakingVenue } from "@binference/chain/staking";
import type { FakeStakingVenue } from "@binference/chain/testing";
import { err, idSchema } from "@binference/core";
import { intentStates, type IntentView, type StakeRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeTokenFacts, fakeTokenFacts } from "../fakes/fake-token-facts.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testCoin, testWallet } from "../intents/test-intents.js";
import { racedTo } from "../intents/test-raced-store.js";
import { testCardText } from "../money-path/test-launches.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import {
  halfCoin,
  stakedFake,
  stakingSimulator,
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

describe("resolving a staking request", () => {
  it("refuses a validator of a chain the registry does not hold and a wallet the agent lacks", async () => {
    const test = await startStakeEngine(testStakingFake());
    const stranger = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const away = accountRefSchema.parse("fake:9:0x000000c1");

    const answers = [
      await answerOf(test, stakeRequest("stake", { validator: away })),
      await answerOf(test, stakeRequest("stake", { wallet: stranger })),
    ];

    expect(answers).toStrictEqual(["protocol.bad_args", "wallet.not_found"]);
    const stored = await test.stores.intents.list({ states: [...intentStates], limit: 10 }, live);
    expect(stored).toStrictEqual([]);
  });

  it("refuses a stake from the agent's bridge wallet, which only makes bridge deposits", async () => {
    const bridge = fixtureId("wal", 0xd2);
    const test = await startStakeEngine(testStakingFake(), { wallets: [testWallet, bridge] });
    test.stores.install.addWallet({
      ...testWalletRecord({ id: bridge, agentId: testAgent, label: "bridge", createdAtMs: 1 }),
      address: "0x000000d2",
      role: "bridge",
    });

    await expect(answerOf(test, stakeRequest("stake", { wallet: bridge }))).resolves.toBe(
      "intent.bridge_wallet_only",
    );
    const stored = await test.stores.intents.list({ states: [...intentStates], limit: 10 }, live);
    expect(stored).toStrictEqual([]);
  });
});

// The fake venue answering each plan as `change` rewrites it.
function rewritingPlans(
  change: (plan: StakePlan) => StakePlan,
  fake: FakeStakingVenue = testStakingFake(),
): StakingVenue {
  return {
    ...fake,
    plan: async (request, call) => {
      const planned = await fake.plan(request, call);
      return planned.ok ? { ...planned, value: change(planned.value) } : planned;
    },
  };
}

// A claim's plan that takes a part of another wallet; any other plan as it is.
function claimingOther(plan: StakePlan): StakePlan {
  return plan.action === "claim" ? { ...plan, parts: ["someone-else:0"] } : plan;
}

async function outcomeOf(test: StakeTest, request = stakeRequest("stake")) {
  const view = await propose(test, request);
  return [view.state, view.outcome?.reason];
}

describe("the engine's own checks of a paper staking plan", () => {
  it("ends a paper stake whose venue cannot name its receipt token with venue_down", async () => {
    const venue = { ...testStakingFake(), receipt: async () => Promise.reject(new Error("down")) };
    const test = await startStakeEngine(venue);

    expect(await outcomeOf(test)).toStrictEqual(["failed_check", "venue_down"]);
  });

  it("ends a stake whose venue cannot build its planned call with venue_down", async () => {
    const venue = { ...testStakingFake(), build: async () => Promise.reject(new Error("down")) };
    const test = await startStakeEngine(venue);

    expect(await outcomeOf(test)).toStrictEqual(["failed_check", "venue_down"]);
  });

  it("ends a paper stake whose plan mints another token than the validator's receipt", async () => {
    const other = assetRefSchema.parse("fake:1/token:0x000000c9");
    const test = await startStakeEngine(
      rewritingPlans((plan) => ({ ...plan, shares: { asset: other, base: plan.value.base } })),
    );

    expect(await outcomeOf(test)).toStrictEqual(["failed_check", "decode_mismatch"]);
  });

  it("ends a paper claim of a part the paper position does not hold", async () => {
    const fake = testStakingFake();
    const test = await startStakeEngine(rewritingPlans(claimingOther, fake));
    await confirm(test, await propose(test));
    await confirm(test, await propose(test, wholeUnstake()));
    fake.wait(testUnbondingSeconds + 1);

    expect(await outcomeOf(test, stakeRequest("claim"))).toStrictEqual([
      "failed_check",
      "decode_mismatch",
    ]);
  });
});

describe("simulating a live staking move", () => {
  it("ends a live stake whose call reverts unsent, before any card", async () => {
    const reverted = { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] } as const;
    const test = await startStakeEngine(await stakedFake(), {
      agent: { mode: "live" },
      chainSimulator: { simulate: async () => Promise.resolve([reverted]) },
    });

    const view = await propose(test);

    expect([view.state, view.outcome?.reason, view.card]).toStrictEqual([
      "failed_check",
      "simulation_reverted",
      undefined,
    ]);
  });

  it("simulates nothing for a stake another write moved as it passed its risk step", async () => {
    const ran: string[] = [];
    const test = await startStakeEngine(await stakedFake(), {
      agent: { mode: "live" },
      intents: racedTo("assessed"),
      chainSimulator: {
        simulate: async () => {
          ran.push("simulated");
          return Promise.resolve([]);
        },
      },
    });

    const view = await propose(test);

    expect([view.state, view.card, ran]).toStrictEqual(["quoted", undefined, []]);
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

  it("opens a card for a stake while a listed MCP server is on for the agent (decision 0428)", async () => {
    const test = await startStakeEngine(withOwnCap(testStakingFake()), {
      agent: { approvalMode: "auto" },
      listedMcpOn: () => true,
    });
    const request = testCall(stakeRequest("stake"), testCallers.runtime);
    const view = expectOk(await test.engine.handlers["intent/propose"](request));

    expect(view.state).toBe("awaiting_confirmation");
    expect(await testCardText(test, view, "en")).toContain(
      "Auto mode asks you here: a listed MCP server is on, and its words reach every turn",
    );
  });

  it("leaves a live stake to the owner's card while the engine is locked", async () => {
    const test = await startStakeEngine(withOwnCap(await stakedFake()), {
      agent: { mode: "live", approvalMode: "auto" },
      isLocked: () => true,
      chainSimulator: stakingSimulator({ simulate: async () => Promise.resolve([]) }),
    });
    const request = testCall(stakeRequest("stake"), testCallers.runtime);
    const view = expectOk(await test.engine.handlers["intent/propose"](request));

    expect(view.state).toBe("awaiting_confirmation");
    expect(await testCardText(test, view, "en")).toContain(
      "Auto mode asks you here: binference is locked; run `binference unlock` on the machine",
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

// A price source that answers no price once `off` is called, as a feed that went quiet.
function quietingPrices() {
  let isQuiet = false;
  return {
    off: () => {
      isQuiet = true;
    },
    wrap: (source: PriceSource): PriceSource => ({
      ...source,
      usdPrice: async (asset, options) =>
        isQuiet ? err("no_price" as const) : source.usdPrice(asset, options),
    }),
  };
}

// Two cards of the same staking request, both waiting for the owner's tap.
async function twoCards(
  test: StakeTest,
  request: StakeRequest,
): Promise<readonly [IntentView, IntentView]> {
  return [await propose(test, request), await propose(test, request)];
}

async function stateOf(test: StakeTest, view: IntentView) {
  const read = expectOk(
    await test.engine.handlers["intent/get"](testCall({ intent: view.intent })),
  );
  return [read.state, read.outcome?.reason];
}

// An intent store that stops the run, as a crash does, right after it writes a paper fill.
function stoppingAtPaperFill(store: IntentStore, controller: AbortController): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (change.state === "paper_filled") {
        controller.abort();
      }
      return moved;
    },
  };
}

// The owner's tap on the intent's card, under the signal given; answers whether it ran to its end.
async function confirmUnder(test: StakeTest, view: IntentView, signal: AbortSignal) {
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("The intent has no card to confirm.");
  }
  const args = { intent: view.intent, card, cardVersion: view.card?.version ?? 1 };
  const call = { ...testCall(args), signal };
  return test.engine.handlers["intent/confirm"](call).then(
    () => "ran",
    () => "stopped",
  );
}

// The paper units the wallet holds of each asset, as its positions keep them.
async function paperUnits(test: StakeTest, view: IntentView) {
  const positions = await test.positions.positions({ walletId: view.wallet, isPaper: true }, live);
  return positions.map(({ asset, quantityBase }) => [asset, quantityBase]);
}

describe("filling a staking move on paper", () => {
  it("ends a stake the paper coin no longer covers with nothing_to_sell", async () => {
    const test = await startStakeEngine(testStakingFake(), {
      paper: [{ asset: testCoin, base: 9n * 10n ** 17n }],
    });
    const [first, second] = await twoCards(test, stakeRequest("stake"));
    await confirm(test, first);
    await confirm(test, second);

    expect(await stateOf(test, first)).toStrictEqual(["paper_filled", undefined]);
    expect(await stateOf(test, second)).toStrictEqual(["failed_check", "nothing_to_sell"]);
  });

  it("ends an unstake of receipt units the paper stake no longer holds with nothing_to_sell", async () => {
    const test = await startStakeEngine(testStakingFake());
    await confirm(test, await propose(test));
    const [first, second] = await twoCards(test, wholeUnstake());
    await confirm(test, first);
    await confirm(test, second);

    expect(await stateOf(test, first)).toStrictEqual(["paper_filled", undefined]);
    expect(await stateOf(test, second)).toStrictEqual(["failed_check", "nothing_to_sell"]);
  });

  it("ends a claim of parts another claim took with nothing_to_sell", async () => {
    const fake = testStakingFake();
    const test = await startStakeEngine(fake);
    await confirm(test, await propose(test));
    await confirm(test, await propose(test, wholeUnstake()));
    fake.wait(testUnbondingSeconds + 1);
    const [first, second] = await twoCards(test, stakeRequest("claim"));
    await confirm(test, first);
    await confirm(test, second);

    expect(await stateOf(test, first)).toStrictEqual(["paper_filled", undefined]);
    expect(await stateOf(test, second)).toStrictEqual(["failed_check", "nothing_to_sell"]);
  });

  it("books at the start, once, a paper stake a stop cut off right after its fill", async () => {
    const controller = new AbortController();
    const test = await startStakeEngine(testStakingFake(), {
      intents: (store) => stoppingAtPaperFill(store, controller),
    });
    const view = await propose(test);
    const whole = await startStakeEngine(testStakingFake());
    const booked = await propose(whole);
    await confirm(whole, booked);

    expect(await confirmUnder(test, view, controller.signal)).toBe("stopped");
    const cutOff = await paperUnits(test, view);
    await test.restart().repairPaperFills(live);
    await test.restart().repairPaperFills(live);

    expect(cutOff).not.toStrictEqual(await paperUnits(whole, booked));
    expect(await paperUnits(test, view)).toStrictEqual(await paperUnits(whole, booked));
  });

  it("stays confirmed, with nothing booked, while the coin has no usable price", async () => {
    const prices = quietingPrices();
    const test = await startStakeEngine(testStakingFake(), { priceSource: prices.wrap });
    const view = await propose(test);
    prices.off();
    await confirm(test, view);

    expect(await stateOf(test, view)).toStrictEqual(["confirmed", undefined]);
    const positions = await test.positions.positions(
      { walletId: view.wallet, isPaper: true },
      live,
    );
    expect(positions.map((position) => position.asset)).toStrictEqual([testCoin]);
  });

  it("books nothing for a paper stake whose fill another write beat", async () => {
    const test = await startStakeEngine(testStakingFake(), { intents: racedTo("paper_filled") });
    const view = await propose(test);
    await confirm(test, view);

    expect(await stateOf(test, view)).toStrictEqual(["confirmed", undefined]);
    const positions = await test.positions.positions(
      { walletId: view.wallet, isPaper: true },
      live,
    );
    expect(positions.map((position) => position.asset)).toStrictEqual([testCoin]);
  });

  it("leaves a short paper stake as it stands when another write beat its end", async () => {
    const test = await startStakeEngine(testStakingFake(), {
      paper: [{ asset: testCoin, base: 9n * 10n ** 17n }],
      intents: racedTo("failed_check"),
    });
    const [first, second] = await twoCards(test, stakeRequest("stake"));
    await confirm(test, first);
    await confirm(test, second);

    expect(await stateOf(test, first)).toStrictEqual(["paper_filled", undefined]);
    expect(await stateOf(test, second)).toStrictEqual(["confirmed", undefined]);
  });
});
