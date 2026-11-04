import { type AssetRef, assetRefSchema, type UsdPrice } from "@binference/chain";
import { createFakeSigner } from "@binference/chain/testing";
import { BinferenceError, bpsSchema, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../agents/agent-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { Holdings } from "../money-path/wallet-facts.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { type FillSizeParts, sizeFill } from "./fill-request.js";
import type { FillTerms } from "./fill-subject.js";
import { fillPrices } from "./test-fills.js";

const signal = AbortSignal.timeout(5_000);
const order: Id<"ord"> = fixtureId("ord", 1);
// The test agent's gas reserve on the fake chain.
const reserveBase = 10n ** 15n;

function terms(changes: Partial<FillTerms> = {}): FillTerms {
  return {
    source: order,
    agentId: testAgent,
    walletId: testWallet,
    isPaper: true,
    token: testToken,
    side: "buy",
    size: { base: 1_000n },
    reason: "Buy the dip",
    isShareSizedNow: false,
    ...changes,
  };
}

// What a sizing asked a wallet holds.
type HoldingQuery = Parameters<Holdings["held"]>[0];

// The sizing parts over the fake chain: the wallet holds what `held` names, custody holds the
// test wallet's account, and prices are the fill tests' unless named.
function partsOf(
  held: ReadonlyMap<AssetRef, bigint>,
  options: { readonly prices?: ReadonlyMap<AssetRef, UsdPrice>; readonly wallets?: boolean } = {},
): FillSizeParts & { readonly asked: HoldingQuery[] } {
  const asked: HoldingQuery[] = [];
  const accounts = options.wallets === false ? new Map() : new Map([[testWallet, testAccount]]);
  return {
    asked,
    holdings: {
      held: async (query) => {
        asked.push(query);
        return held.get(query.asset);
      },
    },
    custody: createFakeSigner(accounts),
    prices: createFakePriceSource(options.prices ?? fillPrices),
    chains: testChains(),
  };
}

async function settingsOf(): Promise<AgentSettings> {
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), { signal });
  const found = await stores.agents.get(testAgent, { signal });
  if (found === undefined) {
    throw new Error("Expected the test agent.");
  }
  return found;
}

async function sized(parts: FillSizeParts, fill: FillTerms) {
  return sizeFill(parts, { terms: fill, settings: await settingsOf(), signal });
}

describe("sizing a fill as its trigger fires", () => {
  it("spends the chain's coin when the buy names nothing, keeping the gas reserve", async () => {
    const parts = partsOf(new Map([[testCoin, reserveBase + 400n]]));

    const fill = await sized(parts, terms({ size: { percentBps: bpsSchema.parse(5_000) } }));

    expect(fill).toMatchObject({
      kind: "sized",
      limitBase: 200n,
      request: { kind: "buy", spend: { asset: testCoin, base: 200n } },
    });
    expect(parts.asked).toMatchObject([{ asset: testCoin, account: testAccount, isPaper: true }]);
  });

  it("spends a token the buy names, with no gas reserve kept from it", async () => {
    const parts = partsOf(new Map([[testToken, 400n]]));
    const fill = await sized(
      parts,
      terms({ spend: testToken, size: { percentBps: bpsSchema.parse(5_000) } }),
    );

    expect(fill).toMatchObject({ kind: "sized", limitBase: 200n });
  });

  it("skips a buy that comes to nothing with nothing to spend", async () => {
    const parts = partsOf(new Map([[testCoin, reserveBase]]));

    const fill = await sized(parts, terms({ size: { percentBps: bpsSchema.parse(10_000) } }));

    expect(fill).toStrictEqual({ kind: "skip", reason: "nothing_to_spend" });
  });

  it("skips a sale that comes to nothing with nothing to sell", async () => {
    const parts = partsOf(new Map([[testToken, 1n]]));

    const fill = await sized(
      parts,
      terms({ side: "sell", size: { percentBps: bpsSchema.parse(5_000) } }),
    );

    expect(fill).toStrictEqual({ kind: "skip", reason: "nothing_to_sell" });
  });

  it("ends a sale of a position that holds none of the token as empty", async () => {
    const fill = await sized(partsOf(new Map([[testToken, 0n]])), terms({ side: "sell" }));

    expect(fill).toStrictEqual({ kind: "empty" });
  });

  it("skips a balance the read had no entry for, which is no data, never zero", async () => {
    const fill = await sized(partsOf(new Map()), terms());

    expect(fill).toStrictEqual({ kind: "skip", reason: "balance_unread" });
  });

  it("skips a size in dollars that nothing prices", async () => {
    const parts = partsOf(new Map([[testCoin, 10n ** 18n]]), { prices: new Map() });

    const fill = await sized(parts, terms({ size: { usdMicros: 5_000_000n } }));

    expect(fill).toStrictEqual({ kind: "skip", reason: "no_price" });
  });

  it("sells no more of a copy order's token than the order bought", async () => {
    const parts = partsOf(new Map([[testToken, 900n]]));

    const fill = await sized(
      parts,
      terms({ side: "sell", size: { base: 800n }, copiedBase: 300n, isShareSizedNow: true }),
    );

    expect(fill).toMatchObject({
      kind: "sized",
      limitBase: 300n,
      request: { kind: "sell", amount: { base: 300n } },
    });
  });

  it("fails loudly when custody holds no account of the wallet", async () => {
    const parts = partsOf(new Map([[testCoin, 1n]]), { wallets: false });

    await expect(sized(parts, terms())).rejects.toMatchObject({ code: "engine.fill_wallet" });
  });

  it("fails loudly for a token on a chain the registry does not hold", async () => {
    const elsewhere = assetRefSchema.parse("fake:2/token:0x0000000a");

    await expect(sized(partsOf(new Map()), terms({ token: elsewhere }))).rejects.toBeInstanceOf(
      BinferenceError,
    );
  });
});
