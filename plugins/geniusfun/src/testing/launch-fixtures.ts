import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  assetRefSchema,
  type LaunchPinRequest,
  type LaunchpadVenue,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { createSeededRandom } from "@binference/plugin-sdk/testing";
import { type Address, getAddress, parseEther } from "viem";
import { readCreateCall } from "../create/create-call.js";
import { createGeniusfunVenue } from "../geniusfun-venue.js";
import type { RecordedCall } from "./recorded-answers.js";
import { scriptedChain } from "./recorded-chain.js";
import { bnb, bscChain, recordedWallet, registryContracts, usdc, usdt } from "./venue-fixtures.js";

// Answers of BNB Chain's public node to the m4.2 factory's launch reads at block 128771000,
// recorded on 2026-10-20, by contract and calldata: a launch fee of 0.002 BNB, launches open to
// the recorded wallet, USDT and USDC approved, and the economics digest of each pair.
const factory = "0x37ee8aee29c5efd3c1a7eda6df3f510779928a37";
const word = (hex: string): `0x${string}` => `0x${hex.padStart(64, "0")}`;
const coinEconomics = word("be3a61d3860e428450d6a309c8f6deecf76b1f270f14f03eb87ee45ad2d81730");
const tokenEconomics = word("91e77165bf15fa37698354115ad79ef81e52c4d00ec2904e2d476a22196c7abd");
const yes = word("1");
const pairWord = (address: string): string => address.slice(2).toLowerCase().padStart(64, "0");

/** The recorded launch reads of the m4.2 factory, by the lower case contract and calldata. */
export const launchReads: ReadonlyMap<string, RecordedCall> = new Map<string, RecordedCall>([
  [`${factory}|0xcf3cf573`, { result: word("71afd498d0000") }],
  [`${factory}|0x236a4afb`, { result: yes }],
  [
    `${factory}|0x58373f04${pairWord("0x000000000000000000000000000000000000beef")}`,
    { result: yes },
  ],
  [
    `${factory}|0x9831705e${pairWord("0x55d398326f99059fF775485246999027B3197955")}`,
    { result: yes },
  ],
  [
    `${factory}|0x9831705e${pairWord("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d")}`,
    { result: yes },
  ],
  [`${factory}|0xf718b78c${word("0").slice(2)}${word("0").slice(2)}`, { result: coinEconomics }],
  [
    `${factory}|0xf718b78c${word("0").slice(2)}${pairWord("0x55d398326f99059fF775485246999027B3197955")}`,
    { result: tokenEconomics },
  ],
  [
    `${factory}|0xf718b78c${word("0").slice(2)}${pairWord("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d")}`,
    { result: tokenEconomics },
  ],
]);

/** The calldata of the factory's `launchEnabled()`, which a test may answer otherwise. */
export const launchEnabledRead: string = `${factory}|0x236a4afb`;

/** The token every fake dry run makes, and the curve it mints the supply to. */
export const madeToken: Address = getAddress("0x00000000000000000000000000000000000c0ffe");
const madeCurve: Address = getAddress("0x00000000000000000000000000000000000cc0fe");

/** How a fake dry run goes: as Genius.fun runs it, reverting, or refunding part of the first buy. */
export type DryRun = "runs" | "reverts" | "refunds";

const at = (address: Address): AccountRef => accountRefSchema.parse(`${bscChain}:${address}`);
const erc20 = (address: Address): AssetRef => assetRefSchema.parse(`${bscChain}/erc20:${address}`);

// What a create call does in the fake: the factory mints the supply to the curve, and the first
// buy gets 1,000 base units of the token for each it spends, less the 2% fee.
function createRun(data: `0x${string}`, wallet: AccountRef, run: DryRun): SimulatedStep {
  const read = readCreateCall(data);
  const bought = read?.terms.firstBuy;
  if (read === undefined || run === "reverts") {
    return { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };
  }
  const mint = {
    from: at("0x0000000000000000000000000000000000000000"),
    to: at(madeCurve),
    amount: { asset: erc20(madeToken), base: parseEther("1000000000") },
  };
  const got =
    bought === undefined
      ? []
      : [
          {
            from: at(madeCurve),
            to: wallet,
            amount: { asset: erc20(madeToken), base: (bought.quoteIn * 98n * 1_000n) / 100n },
          },
        ];
  const refund =
    run === "refunds" && bought !== undefined
      ? [{ from: at(madeCurve), to: wallet, amount: { asset: bnb, base: 1n } }]
      : [];
  return {
    status: "success",
    gasUsed: 400_000n,
    transfers: [mint, ...got, ...refund],
    approvals: [],
  };
}

/**
 * A simulator of a launch's steps for tests: an approval succeeds, and a create call this venue
 * builds runs as {@link DryRun} says. It records every run's balances.
 */
export function launchSimulator(
  run: DryRun = "runs",
): Pick<TxSimulator, "simulate"> & { readonly held: () => readonly (readonly Amount[])[] } {
  const held: (readonly Amount[])[] = [];
  return {
    held: () => [...held],
    async simulate(drafts, options) {
      options.signal.throwIfAborted();
      held.push(options.balances ?? []);
      return await Promise.resolve(
        drafts.map((draft): SimulatedStep => {
          const call = decodeEvmDraft(draft);
          const isApproval = call.ok && call.value.data.startsWith("0x095ea7b3");
          if (!call.ok || isApproval) {
            return {
              status: call.ok ? "success" : "reverted",
              gasUsed: 50_000n,
              transfers: [],
              approvals: [],
            };
          }
          return createRun(call.value.data, draft.from, run);
        }),
      );
    },
  };
}

/** The venue's registry contracts on BSC with the m4.2 router, as the host gives them for a launch. */
const launchContracts: Readonly<Record<string, AccountRef>> = {
  ...registryContracts,
  "router-m4-2": at("0xd8b71b46498A36A4607EAb5C735BeE1DAb7F263d"),
};

/** Genius.fun's launcher on BSC over the recorded factory reads and a fake simulator. */
export function launcherOver(
  simulator: Pick<TxSimulator, "simulate"> = launchSimulator(),
  calls: ReadonlyMap<string, RecordedCall> = launchReads,
): NonNullable<LaunchpadVenue["launcher"]> {
  const rpc = scriptedChain({ calls });
  const venue = createGeniusfunVenue({
    chains: [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt, usdc], rpc }],
    launches: { random: createSeededRandom(277), chains: [{ chain: bscChain, simulator }] },
  });
  if (venue.launcher === undefined) {
    throw new Error("The venue launches no token.");
  }
  return venue.launcher;
}

/** The creator fee recipient of {@link testLaunch}. */
const testRecipient: AccountRef = at("0x00000000000000000000000000000000000000AA");

/** A launch against BNB with a 0.1 BNB first buy, for the recorded wallet. */
export const testLaunch: LaunchPinRequest = {
  wallet: recordedWallet,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: bnb,
  firstBuy: { asset: bnb, base: parseEther("0.1") },
  options: {
    creatorFeeRecipient: testRecipient,
    pictureLink: "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm",
  },
  contracts: launchContracts,
  description: "A cat on the moon",
  links: { website: "https://moon.example", x: "https://x.com/mooncat" },
  image: { contentType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
};
