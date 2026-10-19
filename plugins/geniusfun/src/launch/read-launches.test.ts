import {
  type FoundLaunch,
  type LaunchesFound,
  type LaunchLog,
  type ReadAnswer,
} from "@binference/plugin-sdk";
import { encodeAbiParameters, pad, toEventSelector } from "viem";
import { describe, expect, it } from "vitest";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  geniusLaunchLogs,
  recordedLaunch,
  recordedLaunchAnswers,
} from "../testing/recorded-launch.js";
import {
  bscChain,
  otherQuote,
  partsOver,
  recordedWallet,
  registryContracts,
  venueOver,
} from "../testing/venue-fixtures.js";
import { readGeniusLaunches } from "./read-launches.js";

const venue = venueOver(scriptedChain());

function read(logs: readonly LaunchLog[]): LaunchesFound {
  if (venue.readLaunches === undefined) {
    throw new Error("The venue reads no launch.");
  }
  return venue.readLaunches({ chain: bscChain, contracts: registryContracts, logs });
}

function onlyLaunch(found: LaunchesFound): FoundLaunch {
  const [launch, second] = found.launches;
  if (launch === undefined || second !== undefined) {
    throw new Error("The logs gave other than one launch.");
  }
  return launch;
}

// The launch's facts from these answers to its completion's calls.
function factsFrom(answers: readonly ReadAnswer[]) {
  const { complete } = onlyLaunch(read(geniusLaunchLogs));
  if (complete === undefined) {
    throw new Error("The launch reads nothing to complete it.");
  }
  return complete.facts(answers);
}

const factory = registryContracts["factory-m4-2"] ?? recordedWallet;
const tokenAddress = "0xA7FBB40DE1D29c3bA95233db0378D90f25618B87";
// Every other answer failed, and every other one is cut short.
const brokenAnswers = recordedLaunchAnswers.map((answer, place) =>
  place % 2 === 0 ? undefined : answer?.slice(0, 10),
);
// The launch's logs with every log but the factory's written by a stranger.
const strangerCurve = geniusLaunchLogs.map((log) =>
  log.emitter === factory ? log : { ...log, emitter: recordedWallet },
);

describe("the launch reading of geniusfun", () => {
  it("reads a launch's token, creator, quote token and exempted wallets from its logs", () => {
    const { complete, ...launch } = onlyLaunch(read(geniusLaunchLogs));
    expect(launch).toStrictEqual({
      token: recordedLaunch.token,
      creator: recordedLaunch.creator,
      quoteAsset: otherQuote,
      decimals: 18,
      graduated: false,
      insiders: [recordedLaunch.creator],
      index: 6,
    });
    expect(complete?.calls.map(({ target }) => target)).toStrictEqual([
      ...Array.from({ length: 6 }, () => recordedLaunch.curve),
      `eip155:56:${tokenAddress}`,
      `eip155:56:${tokenAddress}`,
    ]);
  });

  it("completes a launch with its curve's creator tax, snipe tax and progress and its token's words", () => {
    expect(factsFrom(recordedLaunchAnswers)).toStrictEqual({
      symbol: "gALPHA",
      name: "GENIUS ALPHA",
      taxBps: 0,
      snipeTaxBps: 9900,
      curveProgressBps: 467,
      graduated: false,
    });
  });

  it("leaves out each fact whose read failed or answered outside its shape", () => {
    expect(factsFrom(brokenAnswers)).toStrictEqual({});
  });

  it("reads a listed factory's sweep of a token it did not launch as a graduation", () => {
    const swept: LaunchLog = {
      emitter: factory,
      topics: [toEventSelector("LaunchSwept(address,uint256,uint256)"), pad(tokenAddress)],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]),
      index: 40,
    };
    expect(read([swept])).toStrictEqual({
      launches: [],
      changes: [{ token: recordedLaunch.token, graduated: true, index: 40 }],
    });
  });

  it("believes no launch another contract wrote, nor exemptions another curve wrote", () => {
    const forged = geniusLaunchLogs.map((log) => ({ ...log, emitter: recordedWallet }));
    expect(read(forged)).toStrictEqual({ launches: [], changes: [] });
    expect(onlyLaunch(read(strangerCurve)).insiders).toStrictEqual([]);
    const request = { chain: bscChain, contracts: registryContracts, logs: geniusLaunchLogs };
    expect(
      readGeniusLaunches(request, { ...partsOver(scriptedChain()), setups: new Map() }),
    ).toStrictEqual({
      launches: [],
      changes: [],
    });
  });
});
