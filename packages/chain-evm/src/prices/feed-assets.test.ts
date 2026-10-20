import type { ChainDefinition, PriceFeedDefinition } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, evmChainOf } from "../evm-chain.js";
import { feedAssetsOf } from "./feed-assets.js";

const verification = {
  source: "https://docs.invalid",
  checkedOn: "2026-10-10",
  control: "read",
} as const;
const wrapped = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const dollar = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const coinFeed = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
const dollarFeed = "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb";
const otherFeed = "0x52908400098527886E0F7030069857D2E4169EE7";

const definition: ChainDefinition = {
  id: "eip155:31337",
  key: "test-chain",
  name: "Test Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "TEST",
    name: "Test coin",
    decimals: 18,
  },
  blockTimeMs: 1_000,
  finality: { kind: "finalized_tag" },
  rpcs: [{ name: "local", url: "https://rpc.invalid", source: "https://docs.invalid" }],
  relays: [],
  explorers: [
    {
      name: "explorer",
      url: "https://scan.invalid",
      txUrl: "https://scan.invalid/tx/{hash}",
      source: "https://docs.invalid",
    },
  ],
  tokens: [
    { symbol: "WTEST", name: "Wrapped", decimals: 18, address: wrapped, verification },
    { symbol: "USD6", name: "Dollar", decimals: 6, address: dollar, verification },
  ],
  contracts: [
    { venue: "chainlink", name: "test-usd", address: coinFeed, verification },
    { venue: "chainlink", name: "usd6-usd", address: dollarFeed, verification },
    { venue: "chainlink", name: "btc-usd", address: otherFeed, verification },
  ],
};

const feeds: readonly PriceFeedDefinition[] = [
  {
    contract: "test-usd",
    symbol: "TEST",
    decimals: 8,
    heartbeatSeconds: 27,
    isStablecoin: false,
    wrappers: ["WTEST"],
  },
  { contract: "usd6-usd", symbol: "USD6", decimals: 8, heartbeatSeconds: 900, isStablecoin: true },
  { contract: "btc-usd", symbol: "BTC", decimals: 8, heartbeatSeconds: 60, isStablecoin: false },
];

describe("feed assets of a chain", () => {
  it("prices the coin and its wrapper from the coin's feed and a stablecoin from its own", () => {
    const chain = evmChainOf(definition);
    const coin = { address: coinFeed, decimals: 8, heartbeatSeconds: 27 };
    expect(feedAssetsOf(definition, feeds)).toStrictEqual([
      { asset: chain.nativeAsset, decimals: 18, isStablecoin: false, feed: coin },
      { asset: erc20AssetRef(chain, wrapped), decimals: 18, isStablecoin: false, feed: coin },
      {
        asset: erc20AssetRef(chain, dollar),
        decimals: 6,
        isStablecoin: true,
        feed: { address: dollarFeed, decimals: 8, heartbeatSeconds: 900 },
      },
    ]);
  });

  it.each([
    ["a feed proxy", [{ ...feeds[1], contract: "eur-usd" }], "eur-usd"],
    ["a stablecoin", [{ ...feeds[1], symbol: "EURC" }], "EURC"],
    ["a wrapper", [{ ...feeds[0], wrappers: ["WRAP"] }], "WRAP"],
  ] as const)("refuses %s the registry does not name", (_what, listed, name) => {
    expect(() => feedAssetsOf(definition, listed as readonly PriceFeedDefinition[])).toThrow(
      expect.objectContaining({
        code: "chain.bad_price_feeds",
        details: { chain: "test-chain", name },
      }),
    );
  });
});
