import { err, type Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { testAgent, testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import type { PositionStore } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { createPaperPortfolio, type PaperPortfolio } from "./paper-portfolio.js";

const live = { signal: new AbortController().signal };
const coinPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const facts = {
  nativeBalanceBase: 0n,
  ceilingPerTxNativeBase: 0n,
  feePerGasNativeBase: 0n,
  networkFeeCapNativeBase: 0n,
  recentOutflows: [],
};
const startingBalances = [{ asset: testCoin, base: 10n ** 18n }];

function portfolioOn(
  store: PositionStore,
  wallets: readonly Id<"wal">[] = [testWallet],
): PaperPortfolio {
  const prices = createFakePriceSource(new Map([[testCoin, coinPrice]]));
  return createPaperPortfolio({
    positions: createPositions({ store, prices }),
    store,
    wallets: createFakeWalletFacts(new Map([[testAgent, wallets]]), facts),
    clock: createManualClock(testNowMs),
    startingBalances,
  });
}

// A position store whose first `losses` resets lose their race to a paper fill.
function losingResets(store: PositionStore, losses: number): PositionStore {
  let lost = 0;
  return {
    ...store,
    async resetPaper(reset, options) {
      if (lost < losses) {
        lost += 1;
        return await Promise.resolve(err("stale"));
      }
      return store.resetPaper(reset, options);
    },
  };
}

describe("the paper portfolio", () => {
  it("holds a wallet's paper balance as its paper position, and nothing without one", async () => {
    const store = createMemoryPositionStore();
    const portfolio = portfolioOn(store);
    expect(await portfolio.balance(testWallet, testCoin, live)).toBe(0n);
    expect(await portfolio.reset({ agent: testAgent }, live)).toStrictEqual({
      ok: true,
      value: [testWallet],
    });
    expect([
      await portfolio.balance(testWallet, testCoin, live),
      await portfolio.balance(testWallet, testToken, live),
    ]).toStrictEqual([10n ** 18n, 0n]);
  });

  it("answers no wallet for an agent without one, and no price before any change", async () => {
    const store = createMemoryPositionStore();
    expect(await portfolioOn(store, []).reset({ agent: testAgent }, live)).toStrictEqual(
      err("no_wallet"),
    );
    const unpriced = { agent: testAgent, balances: [{ asset: testToken, base: 1n }] };
    expect(await portfolioOn(store).reset(unpriced, live)).toStrictEqual(err("no_price"));
    expect(await store.arrivals({ after: 0, limit: 5, isPaper: true }, live)).toStrictEqual([]);
  });

  it("reads the positions again after a lost race, and faults after three", async () => {
    const store = createMemoryPositionStore();
    const once = await portfolioOn(losingResets(store, 2)).reset({ agent: testAgent }, live);
    expect(once.ok).toBe(true);
    await expect(
      portfolioOn(losingResets(store, 3)).reset({ agent: testAgent }, live),
    ).rejects.toMatchObject({ code: "engine.positions_stale", retryable: true });
  });
});
