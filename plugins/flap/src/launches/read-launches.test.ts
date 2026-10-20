import {
  accountRefSchema,
  assetRefSchema,
  type LaunchesFound,
  type LaunchLog,
} from "@binference/plugin-sdk";
import { encodeAbiParameters, toEventSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  bnb,
  bscChain,
  portalContracts,
  scriptedPortal,
  venueOver,
} from "../testing/portal-fixtures.js";
import { flapBuyLogs, flapLaunchLogs, recordedLaunch } from "../testing/recorded-launches.js";
import { readFlapLaunches } from "./read-launches.js";

const venue = venueOver(scriptedPortal());
function read(logs: readonly LaunchLog[]): LaunchesFound {
  if (venue.readLaunches === undefined) {
    throw new Error("The venue reads no launch.");
  }
  return venue.readLaunches({ chain: bscChain, contracts: portalContracts, logs });
}
// The recorded launch's logs at these places, its quote token and tax left out.
const launchLogsAt = (places: readonly number[]): readonly LaunchLog[] =>
  flapLaunchLogs.filter((_log, place) => places.includes(place));
const portal = flapLaunchLogs.map(({ emitter }) => emitter).find(Boolean) ?? recordedLaunch.creator;
const erc20 = (address: string) => assetRefSchema.parse(`${bscChain}/erc20:${address}`);

describe("the launch reading of flap", () => {
  it("reads a launch's token, creator, words, quote token, tax, no snipe tax, first buyers and curve from the Portal's logs", () => {
    expect(read(flapLaunchLogs)).toStrictEqual({
      launches: [
        {
          token: recordedLaunch.token,
          creator: recordedLaunch.creator,
          quoteAsset: recordedLaunch.quoteToken,
          symbol: "MWTCMWTE",
          name: "More ways to create, more ways to earn.",
          decimals: 18,
          taxBps: 100,
          snipeTaxBps: 0,
          curveProgressBps: 0,
          graduated: false,
          insiders: [recordedLaunch.creator],
          index: 278,
        },
      ],
      changes: [],
    });
  });

  it("reads the chain's coin and no tax when the launch names no quote token and no tax", () => {
    const [launch] = read(launchLogsAt([0, 3, 4])).launches;
    expect(launch).toMatchObject({ quoteAsset: bnb, taxBps: 0, curveProgressBps: 0 });
  });

  it("reads each token a transaction bought and did not create as a curve change", () => {
    expect(read(flapBuyLogs)).toStrictEqual({
      launches: [],
      changes: [
        {
          token: erc20("0x8e5da4b2689Cf7B694eA195E6bCB078027797777"),
          curveProgressBps: 4456,
          index: 889,
        },
        {
          token: erc20("0xfAFA5Fa43a0B1D806fc95A2c23c2AcB5C0b67777"),
          curveProgressBps: 2593,
          index: 919,
        },
      ],
    });
  });

  it("reads a token's move to a pool as its graduation", () => {
    const token = "0x8e5da4b2689Cf7B694eA195E6bCB078027797777";

    const moved: LaunchLog = {
      emitter: portal,
      topics: [toEventSelector("LaunchedToDEX(address,address,uint256,uint256)")],
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [token, token, 1n, 1n],
      ),
      index: 900,
    };
    expect(read([...flapBuyLogs.slice(0, 1), moved]).changes).toStrictEqual([
      { token: erc20(token), graduated: true, index: 900 },
    ]);
  });

  it("passes over a log another contract wrote, a log outside its shape, and a chain it does not trade on", () => {
    const stranger = accountRefSchema.parse(
      `${bscChain}:0x000000000000000000000000000000000000dEaD`,
    );
    const forged = flapLaunchLogs.map((log) => ({ ...log, emitter: stranger }));
    const broken = flapLaunchLogs.map((log) => ({ ...log, data: `${log.data.slice(0, 10)}zz` }));
    expect(read(forged)).toStrictEqual({ launches: [], changes: [] });
    expect(read(broken)).toStrictEqual({ launches: [], changes: [] });
    const request = { chain: bscChain, contracts: portalContracts, logs: flapLaunchLogs };
    expect(readFlapLaunches(request, { setups: new Map() })).toStrictEqual({
      launches: [],
      changes: [],
    });
  });
});
