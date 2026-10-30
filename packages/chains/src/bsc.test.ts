import { describe, expect, it } from "vitest";
import { bsc, bscCeilingCaps, bscPoolHooks, bscPriceFeeds, bscUnboundFirstBuys } from "./bsc.js";
import { checkDefinition } from "./checks/definition-checks.js";
import { isChecksummed } from "./checks/evm-checksum.js";

checkDefinition(bsc, isChecksummed);

describe("bsc", () => {
  it("reads logs from 48 Club's public node, apart from the RPCs that refuse them", () => {
    expect(bsc.logRpcs?.map(({ name, url }) => [name, url])).toStrictEqual([
      ["club48-public", "https://rpc-bsc.48.club"],
    ]);
    const urls = new Set(bsc.rpcs.map(({ url }) => url));
    expect(bsc.logRpcs?.some(({ url }) => urls.has(url))).toBe(false);
  });

  it("gives stablecoins their 18 decimals on this chain", () => {
    const decimals = bsc.tokens
      .filter((token) => ["USDT", "USDC", "FDUSD"].includes(token.symbol))
      .map((token) => token.decimals);
    expect(decimals).toStrictEqual([18, 18, 18]);
  });

  it("keeps PancakeSwap's Permit2 apart from the one Across uses", () => {
    const permits = bsc.contracts.filter((contract) => contract.name === "permit2");
    expect(permits.map(({ venue, address }) => [venue, address])).toStrictEqual([
      ["pancakeswap", "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768"],
      ["across", "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
    ]);
  });
});

describe("bsc price feeds", () => {
  const feedContracts = bsc.contracts
    .filter((contract) => contract.venue === "chainlink")
    .map((contract) => contract.name);

  it("names one feed for each chainlink contract and nothing else", () => {
    expect(bscPriceFeeds.map((feed) => feed.contract).toSorted()).toStrictEqual(
      feedContracts.toSorted(),
    );
  });

  it.each(bscPriceFeeds)("reads $contract as an 8-decimal feed with a heartbeat", (feed) => {
    expect(feed.decimals).toBe(8);
    expect(feed.heartbeatSeconds).toBeGreaterThan(0);
  });

  it("prices WBNB, a registry token with BNB's decimals, with the BNB feed alone", () => {
    const wrapping = bscPriceFeeds.filter((feed) => feed.wrappers !== undefined);
    expect(wrapping.map((feed) => [feed.symbol, feed.wrappers])).toStrictEqual([
      [bsc.nativeAsset.symbol, ["WBNB"]],
    ]);
    const wbnb = bsc.tokens.find((token) => token.symbol === "WBNB");
    expect(wbnb?.decimals).toBe(bsc.nativeAsset.decimals);
  });

  it("marks the stablecoin feeds, each watching the registry token of its symbol", () => {
    const stablecoins = bscPriceFeeds
      .filter((feed) => feed.isStablecoin)
      .map((feed) => feed.symbol);
    expect(stablecoins).toStrictEqual(["USDT", "USDC", "FDUSD"]);
    expect(bsc.tokens.map((token) => token.symbol)).toStrictEqual(
      expect.arrayContaining(stablecoins),
    );
  });
});

describe("bsc ceiling caps", () => {
  it("caps registry tokens only: WBNB at BNB's floor, the stablecoins at a dollar", () => {
    const capped = bscCeilingCaps.tokens.map((item) => item.symbol);
    expect(bsc.tokens.map((token) => token.symbol)).toStrictEqual(expect.arrayContaining(capped));
    const wbnb = bscCeilingCaps.tokens.find((item) => item.symbol === "WBNB");
    expect(wbnb?.floorUsd).toBe(bscCeilingCaps.nativeFloorUsd);
    const stablecoins = bscCeilingCaps.tokens.filter((item) => item.symbol.startsWith("USD"));
    expect(stablecoins.map((item) => item.floorUsd)).toStrictEqual([1_000_000n, 1_000_000n]);
  });
});

describe("bsc launchpads whose first buy runs in the create call", () => {
  it.each(bscUnboundFirstBuys)("lists %s, a venue with contracts in the registry", (venue) => {
    expect(bsc.contracts.some((contract) => contract.venue === venue)).toBe(true);
  });
});

describe("bsc pool hooks", () => {
  const contracts = bsc.contracts.map((contract) => `${contract.venue}/${contract.name}`);
  const hooks = bscPoolHooks.map((hook) => `${hook.venue}/${hook.contract}`);

  it.each(hooks)("names %s among the registry's contracts", (hook) => {
    expect(contracts.filter((contract) => contract === hook)).toHaveLength(1);
  });

  it.each(bscPoolHooks)("keeps a whole number of basis points for $contract", ({ feeBps }) => {
    expect(Math.trunc(feeBps)).toBe(feeBps);
    expect(feeBps).toBeGreaterThanOrEqual(0);
    expect(feeBps).toBeLessThan(10_000);
  });

  it.each(bscPoolHooks)("names who made $contract's pools as a card can show it", ({ maker }) => {
    expect(maker).toMatch(/^[A-Za-z0-9][A-Za-z0-9 .-]{0,39}$/u);
  });

  it("lists each hook once", () => {
    expect(new Set(hooks).size).toBe(hooks.length);
  });
});
