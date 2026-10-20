import {
  chainRefSchema,
  defineLaunchpad,
  type InsiderReader,
  type LaunchpadVenue,
  type LaunchReader,
  type PriceReader,
  type TxDraft,
} from "@binference/plugin-sdk";
import {
  curveReaderContract,
  hostBuildRequest,
  insiderReaderContract,
  launchReaderContract,
  priceReaderContract,
  quoterContract,
  txBuilderContract,
  txDecoderContract,
} from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { tradeFunctionsJson } from "./contracts/genius-calls.js";
import { createFunctionsJson } from "./contracts/launch-call.js";
import { createGeniusfunVenue, geniusfunDeclaration } from "./geniusfun-venue.js";
import { recordedCalls } from "./testing/recorded-answers.js";
import { scriptedChain } from "./testing/recorded-chain.js";
import { geniusLaunchLogs, recordedLaunch } from "./testing/recorded-launch.js";
import {
  bnb,
  bscChain,
  contractsWith,
  graduatedToken,
  recordedWallet,
  registryContracts,
  requestOf,
  stackCurve,
  stackToken,
  usdt,
  venueOver,
} from "./testing/venue-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const buyRequest = requestOf({ asset: bnb, base: parseEther("0.1") }, stackToken);
const saleRequest = requestOf({ asset: stackToken, base: parseEther("1000000") }, bnb);
// One venue quotes and builds the drafts its decoder then reads: it reads a curve's launch when
// it quotes or builds for it.
const builder = venueOver(scriptedChain());
const quoted = await builder.quote(buyRequest, { signal: live() });
if (!quoted.ok) {
  throw new Error("The recorded answers gave no quote.");
}
const buildRequest = hostBuildRequest(buyRequest, quoted.value, { deadlineMs: 1_800_000_060_000 });
const [buy] = await builder.build(buildRequest, { signal: live() });
const saleQuote = await builder.quote(saleRequest, { signal: live() });
if (!saleQuote.ok) {
  throw new Error("The recorded answers gave no sale quote.");
}
const [approval] = await builder.build(
  hostBuildRequest(saleRequest, saleQuote.value, { deadlineMs: 1_800_000_060_000 }),
  { signal: live() },
);

function draftOf(draft: TxDraft | undefined): TxDraft {
  if (draft === undefined) {
    throw new Error("The build gave no draft.");
  }
  return draft;
}

function priceReaderOf(venue: LaunchpadVenue): PriceReader {
  const read = venue.priceRead?.bind(venue);
  if (read === undefined) {
    throw new Error("The venue declares no price read.");
  }
  return { priceRead: read };
}

function insiderReaderOf(venue: LaunchpadVenue): InsiderReader {
  const read = venue.insiders?.bind(venue);
  if (read === undefined) {
    throw new Error("The venue reads no insiders.");
  }
  return { insiders: read };
}

function launchReaderOf(venue: LaunchpadVenue): LaunchReader {
  const { launchEvents, readLaunches } = venue;
  if (launchEvents === undefined || readLaunches === undefined) {
    throw new Error("The venue reads no launch.");
  }
  return { launchEvents, readLaunches };
}

// The answers of the curve's two price reads at the recorded block, in their order.
function priceAnswers(): readonly string[] {
  return ["0x0902f1ac", "0x808bcddc"].map((data) => {
    const answer = recordedCalls.get(`${stackCurve.toLowerCase()}|${data}`);
    if (answer === undefined || !("result" in answer)) {
      throw new Error("The curve's read was not recorded.");
    }
    return answer.result;
  });
}

describe("the geniusfun venue", () => {
  it.each([
    ...quoterContract({
      create: () => ({
        quoter: venueOver(scriptedChain()),
        request: buyRequest,
        // The host gives a graduated token no curve: the curve read names none.
        unroutable: {
          ...requestOf({ asset: bnb, base: parseEther("0.1") }, graduatedToken),
          contracts: registryContracts,
        },
      }),
    }),
    ...txBuilderContract({
      create: () => ({ builder: venueOver(scriptedChain()), request: buildRequest }),
    }),
    ...txDecoderContract({
      create: () => ({
        decoder: builder,
        draft: draftOf(buy),
        effect: {
          recipient: recordedWallet,
          amountIn: buildRequest.amountIn,
          minOut: buildRequest.minOut,
        },
        foreign: draftOf(approval),
      }),
    }),
    ...curveReaderContract({
      create: () => ({
        reader: venueOver(scriptedChain()),
        onCurve: { token: stackToken, contracts: registryContracts },
        offCurve: { token: graduatedToken, contracts: registryContracts },
      }),
    }),
    ...priceReaderContract({
      create: () => ({
        reader: priceReaderOf(venueOver(scriptedChain())),
        priced: { token: stackToken, contracts: contractsWith(stackCurve) },
        answers: priceAnswers(),
        unpriced: { token: graduatedToken, contracts: registryContracts },
      }),
    }),
    ...insiderReaderContract({
      create: () => ({
        reader: insiderReaderOf(venueOver(scriptedChain())),
        launched: { token: stackToken, contracts: registryContracts },
        other: { token: usdt, contracts: registryContracts },
      }),
    }),
    ...launchReaderContract({
      create: () => ({
        reader: launchReaderOf(venueOver(scriptedChain())),
        chain: bscChain,
        contracts: registryContracts,
        launch: { logs: geniusLaunchLogs, token: recordedLaunch.token },
        other: geniusLaunchLogs.filter((log) => log.index !== 6),
        stranger: recordedWallet,
      }),
    }),
  ])("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("declares each stack's factory, each launch's curve, its buy and sell, its create calls for launch wallets alone, and no deadline", () => {
    const declaration = geniusfunDeclaration([bscChain]);
    expect(declaration).toStrictEqual({
      id: "geniusfun",
      contracts: [
        {
          chain: bscChain,
          names: ["factory-m4-2", "factory-m4-1", "router-m4-2"],
          launchContracts: ["curve"],
          calls: [
            { contract: "curve", abi: tradeFunctionsJson.buy, walletInputs: ["recipient"] },
            { contract: "curve", abi: tradeFunctionsJson.sell, walletInputs: ["recipient"] },
            {
              contract: "router-m4-2",
              abi: createFunctionsJson.launchAndBuy,
              walletInputs: [],
              isLaunchWalletOnly: true,
            },
            {
              contract: "factory-m4-2",
              abi: createFunctionsJson.launchToken,
              walletInputs: [],
              isLaunchWalletOnly: true,
            },
          ],
          spenders: ["curve"],
          launchWalletSpenders: ["router-m4-2"],
          noDeadline: true,
        },
      ],
    });
    expect(() => defineLaunchpad({ ...venueOver(scriptedChain()), ...declaration })).not.toThrow();
  });

  it.each([
    ["no chain", []],
    [
      "a native asset of another chain",
      [{ chain: bscChain, nativeAsset: usdt, quoteTokens: [], rpc: scriptedChain() }],
    ],
    [
      "a quote token of another chain",
      [
        {
          chain: chainRefSchema.parse("eip155:1"),
          nativeAsset: bnb,
          quoteTokens: [usdt],
          rpc: scriptedChain(),
        },
      ],
    ],
  ] as const)("refuses options with %s", (_case, chains) => {
    expect(() => createGeniusfunVenue({ chains })).toThrow(
      expect.objectContaining({ code: "geniusfun.bad_options" }),
    );
  });
});
