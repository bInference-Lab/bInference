import {
  type BuildRequest,
  chainRefSchema,
  type LaunchReader,
  type TxDraft,
  type Venue,
} from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { launchReaderContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { brewDeclaration, createBrewVenue } from "./brew-venue.js";
import {
  bnb,
  boughtLaunch,
  bscChain,
  multiPairFactory,
  plainLaunch,
  registryContracts,
  wbnb,
} from "./testing/recorded-launches.js";

const bscBrew = { chain: bscChain, nativeAsset: bnb, wrappedNative: wbnb };
const chains = [bscBrew];
const venue = createBrewVenue({ chains });

function launchReaderOf(of: Venue): LaunchReader {
  const { launchEvents, readLaunches } = of;
  if (launchEvents === undefined || readLaunches === undefined) {
    throw new Error("The venue reads no launch.");
  }
  return { launchEvents, readLaunches };
}

const live = (): AbortSignal => new AbortController().signal;
const quoteRequest = {
  wallet: boughtLaunch.creator,
  amountIn: { asset: bnb, base: 10n ** 16n },
  assetOut: boughtLaunch.token,
  contracts: registryContracts,
};
const draft: TxDraft = encodeEvmDraft({
  from: boughtLaunch.creator,
  to: registryContracts["factory"] ?? multiPairFactory,
  value: 0n,
  data: "0x7cd1f68e",
});

describe("the brew venue", () => {
  it.each(
    launchReaderContract({
      create: () => ({
        reader: launchReaderOf(venue),
        chain: bscChain,
        contracts: registryContracts,
        launch: { logs: boughtLaunch.logs, token: boughtLaunch.token },
        other: [boughtLaunch.bought],
        stranger: multiPairFactory,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("declares BrewFactory alone on each chain it serves", () => {
    expect(brewDeclaration([bscChain])).toStrictEqual({
      id: "brew",
      contracts: [{ chain: bscChain, names: ["factory"] }],
    });
    expect(venue.contracts).toStrictEqual(brewDeclaration([bscChain]).contracts);
  });

  it("quotes, builds and decodes no trade: its tokens trade in their pools", async () => {
    await expect(venue.quote(quoteRequest, { signal: live() })).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
    const reason = new Error("stopped");
    await expect(venue.quote(quoteRequest, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    await expect(venue.build({} as BuildRequest, { signal: live() })).rejects.toMatchObject({
      code: "brew.no_trade",
    });
    expect(venue.decode(draft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });

  it("reads the launches of the logs it is given, each launch once", () => {
    const found = launchReaderOf(venue).readLaunches({
      chain: bscChain,
      contracts: registryContracts,
      logs: [...plainLaunch.logs, ...boughtLaunch.logs],
    });
    expect(found.launches.map(({ token }) => token)).toStrictEqual([
      plainLaunch.token,
      boughtLaunch.token,
    ]);
  });

  it("refuses a chain given twice, or a wrapped coin that is no token of its chain", () => {
    expect(() => createBrewVenue({ chains: [...chains, ...chains] })).toThrow(
      expect.objectContaining({ code: "brew.bad_options" }),
    );
    const otherChain = chainRefSchema.parse("eip155:1");
    expect(() => createBrewVenue({ chains: [{ ...bscBrew, chain: otherChain }] })).toThrow(
      expect.objectContaining({ code: "brew.bad_options" }),
    );
    expect(() =>
      createBrewVenue({ chains: [{ chain: bscChain, nativeAsset: bnb, wrappedNative: bnb }] }),
    ).toThrow(expect.objectContaining({ code: "brew.bad_options" }));
  });
});
