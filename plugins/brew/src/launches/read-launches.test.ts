import { chainRefSchema, type LaunchesFound, type LaunchLog } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { brewSetupsOf } from "../brew-setups.js";
import {
  bnb,
  boughtLaunch,
  bscChain,
  multiPairFactory,
  plainLaunch,
  registryContracts,
  wbnb,
} from "../testing/recorded-launches.js";
import { readBrewLaunches } from "./read-launches.js";

const setups = brewSetupsOf([{ chain: bscChain, nativeAsset: bnb, wrappedNative: wbnb }]);
const nothing: LaunchesFound = { launches: [], changes: [] };

function read(logs: readonly LaunchLog[], contracts = registryContracts): LaunchesFound {
  return readBrewLaunches({ chain: bscChain, contracts, logs }, setups);
}

const tokensOf = (found: LaunchesFound) => found.launches.map(({ token }) => token);
const insidersOf = (found: LaunchesFound) => found.launches.map(({ insiders }) => insiders);

// The launch's create log, its pair's topic set to USDT.
const usdtTopic = "0x00000000000000000000000055d398326f99059ff775485246999027b3197955";
const againstUsdt: LaunchLog = {
  ...boughtLaunch.created,
  topics: [...boughtLaunch.created.topics.slice(0, 3), usdtTopic],
};

describe("the launch reading of brew", () => {
  it("reads a launch's token, creator, words and pair, and its first buy's recipient as insider", () => {
    expect(read(boughtLaunch.logs)).toStrictEqual({
      launches: [
        {
          token: boughtLaunch.token,
          creator: boughtLaunch.creator,
          quoteAsset: bnb,
          decimals: 18,
          graduated: true,
          insiders: [boughtLaunch.creator],
          index: 346,
          name: "Heyi.ai",
          symbol: "HEYI",
          taxBps: 0,
          snipeTaxBps: 0,
        },
      ],
      changes: [],
    });
  });

  it("names no insider for a launch with no first buy", () => {
    const found = read(plainLaunch.logs);
    expect(tokensOf(found)).toStrictEqual([plainLaunch.token]);
    expect(insidersOf(found)).toStrictEqual([[]]);
  });

  it("reads each launch of a transaction that holds two", () => {
    expect(tokensOf(read([...boughtLaunch.logs, ...plainLaunch.logs]))).toStrictEqual([
      boughtLaunch.token,
      plainLaunch.token,
    ]);
  });

  it("believes no launch another contract wrote, such as a multi-pair factory", () => {
    const forged = boughtLaunch.logs.map((log) => ({ ...log, emitter: multiPairFactory }));
    expect(read(forged)).toStrictEqual(nothing);
  });

  it("names no insider from a first buy another contract wrote", () => {
    const strangerBuy = { ...boughtLaunch.bought, emitter: multiPairFactory };
    expect(insidersOf(read([boughtLaunch.created, strangerBuy]))).toStrictEqual([[]]);
  });

  it("reads nothing on a chain it does not serve, or without its factory", () => {
    const chain = chainRefSchema.parse("eip155:1");
    const elsewhere = { chain, contracts: registryContracts, logs: boughtLaunch.logs };
    expect(readBrewLaunches(elsewhere, setups)).toStrictEqual(nothing);
    expect(read(boughtLaunch.logs, {})).toStrictEqual(nothing);
  });

  it("passes over a log outside its shape", () => {
    const cut = { ...boughtLaunch.created, data: boughtLaunch.created.data.slice(0, 66) };
    expect(read([cut])).toStrictEqual(nothing);
  });

  it("names a token pair as that token, and only the wrapped coin as the coin", () => {
    expect(read([againstUsdt]).launches.map(({ quoteAsset }) => quoteAsset)).toStrictEqual([
      "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
    ]);
  });
});
