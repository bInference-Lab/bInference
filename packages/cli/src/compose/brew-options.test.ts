import { createBrewVenue } from "@binference/brew";
import { chainRefSchema } from "@binference/chain";
import {
  createScriptedHttp,
  createManualClock,
  createSeededRandom,
} from "@binference/core/testing";
import { createLaunchHost, createVenueHost } from "@binference/engine";
import { describe, expect, it } from "vitest";
import { brewOptionsOf } from "./brew-options.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains, selfHostedFeeds } from "./open-engine-parts.js";

const bsc = chainRefSchema.parse("eip155:56");
const chains = selfHostedChains();
const clock = createManualClock(1_800_000_000_000);
// The coin joins the registry's tokens, and WBNB leaves them.
const registryTokens = chains.list().flatMap((chain) => chain.definition.tokens).length;
const config = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };

// The pairs Brew launches against on BSC, each with its fixed start, if any.
function bscPairs() {
  const [launching] = optionsOf().launches?.chains ?? [];
  if (launching === undefined) {
    throw new Error("Brew launches on no chain.");
  }
  return launching.pairs.map(({ asset, startBase }) => [asset, startBase]);
}

function optionsOf() {
  const reads = composeChainReads({ chains, config, http: createScriptedHttp([]), clock });
  return brewOptionsOf(chains.list(), {
    feeds: selfHostedFeeds(),
    reads,
    random: createSeededRandom(283),
  });
}

describe("the brew venue's options on BSC", () => {
  it("launch against BNB and every registry token but WBNB, with the owner's fixed starts", () => {
    const starts = bscPairs();
    expect(starts.slice(0, 3)).toStrictEqual([
      ["eip155:56/slip44:714", 8n * 10n ** 18n],
      ["eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955", 5_000n * 10n ** 18n],
      ["eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 5_000n * 10n ** 18n],
    ]);
    expect(starts).toContainEqual([
      "eip155:56/erc20:0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      undefined,
    ]);
    const wbnb = "eip155:56/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    expect(starts.map(([asset]) => asset)).not.toContain(wbnb);
    expect(starts).toHaveLength(registryTokens);
  });

  it("is hosted as a venue that only launches, writing a small picture into its create call", () => {
    const venue = createBrewVenue(optionsOf());
    const host = createLaunchHost({ venues: [venue], chains, clock, callTimeoutMs: 5_000 });
    const venues = createVenueHost({ venues: [venue], chains, clock, callTimeoutMs: 5_000 });
    expect(host.picturePlace("brew")).toBe("create_call");
    expect(host.pictureBytesFor("brew", {})).toBeGreaterThan(1_000);
    expect(host.cardWarnings("brew")).toStrictEqual(["notForUsCitizens"]);
    expect(host.launchOptions("brew").map(({ name }) => name)).toStrictEqual([
      "poolFeeRecipient",
      "holderRewards",
      "startMarketCap",
      "poolFee",
      "liquidity",
      "startBasis",
      "holderDistributor",
    ]);
    expect(host.outsideOnlySettings("brew")).toStrictEqual([
      "poolFeeRecipient",
      "holderDistributor",
    ]);
    expect(venues.launchesOnly("brew")).toBe(true);
    expect(venues.launchWalletCalls(["brew"])).toHaveLength(1);
  });
});
