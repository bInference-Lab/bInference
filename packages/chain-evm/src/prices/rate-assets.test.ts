import type { ChainDefinition, RatePriceDefinition } from "@binference/chain";
import { concatHex, encodeAbiParameters, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, evmChainOf } from "../evm-chain.js";
import { rateAssetsOf } from "./rate-assets.js";

const verification = {
  source: "https://docs.invalid",
  checkedOn: "2026-11-02",
  control: "read",
} as const;
const staked = "0x52908400098527886E0F7030069857D2E4169EE7";
const manager = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const feed = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

// A chain whose coin has 18 decimals and whose staked token has 9, so the two scales differ.
const definition: ChainDefinition = {
  id: "eip155:31337",
  key: "rate-chain",
  name: "Rate Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "RATE",
    name: "Rate coin",
    decimals: 18,
  },
  blockTimeMs: 1_000,
  finality: { kind: "finalized_tag" },
  rpcs: [{ name: "local", url: "https://rpc.invalid", source: "https://docs.invalid" }],
  relays: [],
  explorers: [],
  tokens: [{ symbol: "stRATE", name: "Staked", decimals: 9, address: staked, verification }],
  contracts: [
    { venue: "staker", name: "manager", address: manager, verification },
    { venue: "chainlink", name: "strate-rate", address: feed, verification },
  ],
};

const rate: RatePriceDefinition = {
  symbol: "stRATE",
  venue: "staker",
  contract: "manager",
  convertFunction: "toCoin",
  minRateBps: 10_000,
  maxRateBps: 12_000,
  checkFeed: { contract: "strate-rate", decimals: 8, heartbeatSeconds: 3_600, maxGapBps: 50 },
};

describe("rate assets of a chain", () => {
  it("converts one whole token, in the token's own decimals, through the named contract", () => {
    const chain = evmChainOf(definition);
    expect(rateAssetsOf(definition, [rate])).toStrictEqual([
      {
        asset: erc20AssetRef(chain, staked),
        coin: chain.nativeAsset,
        unit: 10n ** 9n,
        coinUnit: 10n ** 18n,
        converter: manager,
        convertCall: concatHex([
          toFunctionSelector("function toCoin(uint256)"),
          encodeAbiParameters([{ type: "uint256" }], [10n ** 9n]),
        ]),
        minRateBps: 10_000,
        maxRateBps: 12_000,
        checkFeed: { address: feed, feedUnit: 10n ** 8n, heartbeatSeconds: 3_600, maxGapBps: 50 },
      },
    ]);
  });

  it.each<[string, Partial<RatePriceDefinition>, string]>([
    ["a token the registry does not name", { symbol: "stOTHER" }, "stOTHER"],
    ["a contract the registry does not name", { contract: "router" }, "router"],
    ["a function name that is not one", { convertFunction: "toCoin(uint256)" }, "stRATE"],
    ["a floor of zero", { minRateBps: 0 }, "stRATE"],
    ["a floor at its ceiling", { maxRateBps: 10_000 }, "stRATE"],
    ["a floor that is not a whole number", { minRateBps: 10_000.5 }, "stRATE"],
    ["a feed the registry does not name", { checkFeed: { ...rate.checkFeed, contract: "x" } }, "x"],
    ["a feed with no gap", { checkFeed: { ...rate.checkFeed, maxGapBps: 0 } }, "stRATE"],
    [
      "a feed with no heartbeat",
      { checkFeed: { ...rate.checkFeed, heartbeatSeconds: 0 } },
      "stRATE",
    ],
    ["a feed of 37 decimals", { checkFeed: { ...rate.checkFeed, decimals: 37 } }, "stRATE"],
  ])("refuses %s", (_what, change, name) => {
    expect(() => rateAssetsOf(definition, [{ ...rate, ...change }])).toThrow(
      expect.objectContaining({
        code: "chain.bad_price_feeds",
        details: { chain: "rate-chain", name },
      }),
    );
  });
});
