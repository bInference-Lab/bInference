import {
  type AccountRef,
  assetRefSchema,
  chainRefSchema,
  type SimulatedStep,
} from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { RescueMove } from "../intents/rescue-quote.js";
import { testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { checkRescueMoves } from "./check-rescue-moves.js";
import { payloadOf, testRescue } from "./test-rescue.js";

const live = { signal: new AbortController().signal };
const tax = "fake:1:0x000000ee" as AccountRef;
const tokenMove: RescueMove = {
  wallet: testWallet,
  from: testAccount,
  amount: { asset: testToken, base: 100n },
};
const coinMove: RescueMove = {
  wallet: testWallet,
  from: testAccount,
  amount: { asset: testCoin, base: 7n },
};

function chain() {
  const registered = testChains().get(chainRefSchema.parse("fake:1"));
  if (!registered.ok) {
    throw new Error("Expected the fake chain.");
  }
  return registered.value;
}

function step(transfers: SimulatedStep["transfers"], changes: Partial<SimulatedStep> = {}) {
  return { status: "success", gasUsed: 1n, transfers, approvals: [], ...changes } as const;
}

async function check(moves: readonly RescueMove[], steps: ReadonlyMap<string, SimulatedStep>) {
  const parts = {
    simulator: createFakeTxSimulator(steps),
    chain: chain(),
    clock: createManualClock(testNowMs),
  };
  return checkRescueMoves(parts, { moves, rescue: testRescue, signal: live.signal });
}

describe("the simulation of a rescue", () => {
  it("keeps a token that takes a tax on transfers, counting what reached the rescue address", async () => {
    const taxed = step([
      { from: testAccount, to: testRescue, amount: { asset: testToken, base: 90n } },
      { from: testAccount, to: tax, amount: { asset: testToken, base: 10n } },
    ]);
    const sent = step([{ from: testAccount, to: testRescue, amount: coinMove.amount }]);
    const checked = await check(
      [tokenMove, coinMove],
      new Map([
        [payloadOf(tokenMove), taxed],
        [payloadOf(coinMove), sent],
      ]),
    );
    expect(checked.moves).toStrictEqual([tokenMove, coinMove]);
    expect(checked.drafts.map(({ payload }) => payload)).toStrictEqual([
      payloadOf(tokenMove),
      payloadOf(coinMove),
    ]);
    expect(checked.simulation).toStrictEqual({
      spent: [tokenMove.amount, coinMove.amount],
      received: [{ asset: testToken, base: 90n }, coinMove.amount],
      simulatedAt: testNowMs,
    });
  });

  it("leaves out a step that reverts, sets an allowance, moves another asset or less, or delivers nothing", async () => {
    const arrives = { from: testAccount, to: testRescue, amount: tokenMove.amount };
    const cases: readonly SimulatedStep[] = [
      step([], { status: "reverted" }),
      step([arrives], {
        approvals: [{ owner: testAccount, spender: tax, amount: tokenMove.amount }],
      }),
      step([arrives, { from: testAccount, to: tax, amount: coinMove.amount }]),
      step([{ ...arrives, amount: { asset: testToken, base: 99n } }]),
      step([{ ...arrives, to: tax }]),
    ];
    const sent = step([{ from: testAccount, to: testRescue, amount: coinMove.amount }]);
    const checked = await Promise.all(
      cases.map(async (failing) =>
        check(
          [tokenMove, coinMove],
          new Map([
            [payloadOf(tokenMove), failing],
            [payloadOf(coinMove), sent],
          ]),
        ),
      ),
    );
    expect(checked.map(({ moves }) => moves)).toStrictEqual(cases.map(() => [coinMove]));
  });

  it("leaves out an asset its family cannot send, and keeps nothing of no moves", async () => {
    const nft = {
      ...tokenMove,
      amount: { asset: assetRefSchema.parse("fake:1/nft:0x0000000a"), base: 1n },
    };
    const checked = await check([nft], new Map());
    expect(checked).toStrictEqual({
      moves: [],
      drafts: [],
      simulation: { spent: [], received: [], simulatedAt: testNowMs },
    });
  });
});
