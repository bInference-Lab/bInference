import type { RegisteredChain } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { selfHostedChains, selfHostedFeeds } from "./open-engine-parts.js";
import { wrappedCoinOf } from "./wrapped-coins.js";

function bscOf(): RegisteredChain {
  const [chain] = selfHostedChains().list();
  if (chain === undefined) {
    throw new Error("The registry holds no chain.");
  }
  return chain;
}

const feeds = [...selfHostedFeeds().values()].flat();

describe("the wrapped coin of a chain", () => {
  it("is the registry token its coin's feed names as wrapping it", () => {
    expect(wrappedCoinOf(bscOf(), feeds)).toBe(
      "eip155:56/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    );
  });

  it("is none when no feed names one", () => {
    const unwrapped = feeds.map(({ wrappers: _wrappers, ...feed }) => feed);
    expect(wrappedCoinOf(bscOf(), unwrapped)).toBeUndefined();
  });
});
