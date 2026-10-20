import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type Amount,
  type AssetRef,
  assetRefSchema,
  type LaunchPinRequest,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
  type Venue,
} from "@binference/plugin-sdk";
import {
  decodeEvmDraft,
  type EvmDraftCall,
  type RpcCall,
  type RpcFailover,
  type RpcReply,
} from "@binference/plugin-sdk/evm";
import { createSeededRandom } from "@binference/plugin-sdk/testing";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  type Hex,
  parseAbi,
  parseEther,
} from "viem";
import { z } from "zod";
import { createBrewVenue } from "../brew-venue.js";
import { readLaunchCall } from "../contracts/launch-call.js";
import { distributorAddressOf } from "../create/brew-distributor.js";
import { tokenAddressOf } from "../create/brew-token.js";
import { bnb, bscChain, registryContracts, wbnb } from "./recorded-launches.js";

/** BSC's USDT, a pair Brew launches against with a fixed start. */
export const usdt: AssetRef = assetRefSchema.parse(
  "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
);

/** A registry token Brew launches against with no fixed start: BTCB. */
export const btcb: AssetRef = assetRefSchema.parse(
  "eip155:56/erc20:0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
);

const at = (address: string): AccountRef => accountRefSchema.parse(`${bscChain}:${address}`);

/** The launch wallet of the tests. */
export const launchWallet: AccountRef = at("0x00000000000000000000000000000000000000D9");

/** A holder distributor no Brew token gets, which a lying distributor factory predicts. */
export const otherDistributor: Address = getAddress("0x00000000000000000000000000000000000d157b");

/** BrewFactory and the distributor factory as the host gives them for a launch. */
export const launchContracts: Readonly<Record<string, AccountRef>> = {
  ...registryContracts,
  "distributor-factory": at("0xd765972dD6a09Fa9c743b4708198A820FC5D31EE"),
};

// BrewFactory's address, which a token's holder distributor takes.
const brewFactory = getAddress(
  accountRefParts(registryContracts["factory"] ?? launchWallet).address,
);

const readsAbi = parseAbi([
  "function launchFeeWei() view returns (uint256)",
  "function paused() view returns (bool)",
  "function predictTokenAddress(address creator, bytes32 salt, string name, string symbol, uint256 totalSupply, string metadataURI) view returns (address)",
  "function predict(address token) view returns (address)",
]);

/**
 * How the fake BrewFactory answers: its fee, its pause, whether it predicts another token, and
 * the holder distributor the distributor factory predicts in place of the token's own.
 */
export interface FactoryScript {
  readonly feeBase?: bigint;
  readonly isPaused?: boolean;
  readonly predictsOther?: boolean;
  readonly predictsDistributor?: Address;
}

const callSchema = z.tuple([z.object({ to: z.string(), data: z.string() }), z.literal("latest")]);
const hexSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && value.startsWith("0x"),
);
const word = (value: bigint | boolean | Address): Hex =>
  typeof value === "string"
    ? encodeAbiParameters([{ type: "address" }], [value])
    : encodeAbiParameters([{ type: typeof value === "bigint" ? "uint256" : "bool" }], [value]);

// The fake's answer to one view: what BrewFactory's verified source returns for it.
function answerOf(to: string, data: Hex, script: FactoryScript): Hex {
  const call = decodeFunctionData({ abi: readsAbi, data });
  if (call.functionName === "launchFeeWei") {
    return word(script.feeBase ?? 0n);
  }
  if (call.functionName === "paused") {
    return word(script.isPaused === true);
  }
  if (call.functionName === "predict") {
    const factories = { distributorFactory: getAddress(to), brewFactory };
    return word(script.predictsDistributor ?? distributorAddressOf(factories, call.args[0]));
  }
  const [creator, salt, name, symbol, totalSupply, metadataURI] = call.args;
  const create = { factory: getAddress(to), creator, name, symbol, totalSupply, metadataURI };
  return word(script.predictsOther === true ? otherDistributor : tokenAddressOf(create, salt));
}

/** A failover that answers BrewFactory's and the distributor factory's views as the script says. */
export function factoryChain(script: FactoryScript = {}): RpcFailover {
  return {
    async request<T>(call: RpcCall<T>): Promise<RpcReply<T>> {
      const [{ to, data }] = callSchema.parse(call.params);
      const value = answerOf(to, hexSchema.parse(data), script);
      return Promise.resolve({ kind: "result", endpoint: "fake", value: call.result.parse(value) });
    },
    health: () => [],
  };
}

/** How a fake dry run goes: as BrewFactory runs it, reverting, or refunding part of the first buy. */
export type DryRun = "runs" | "reverts" | "refunds";

// What a create call does in the fake: the first buy gets 1,000 base units of the token for each
// it spends, from the new pool, the token at the address the factory gives it.
function createRun(call: EvmDraftCall, from: AccountRef, run: DryRun): SimulatedStep {
  const params = readLaunchCall(call.data);
  if (params === undefined || run === "reverts") {
    return { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };
  }
  const pool = at("0x00000000000000000000000000000000000000F0");
  const { name, symbol, totalSupply, metadataURI } = params;
  const create = { factory: call.to, creator: call.from, name, symbol, totalSupply, metadataURI };
  const token = assetRefSchema.parse(`${bscChain}/erc20:${tokenAddressOf(create, params.salt)}`);
  const bought = params.initialBuyQuoteAmount;
  const got =
    bought === 0n
      ? []
      : [{ from: pool, to: from, amount: { asset: token, base: bought * 1_000n } }];
  const refund =
    run === "refunds" ? [{ from: pool, to: from, amount: { asset: bnb, base: 1n } }] : [];
  return { status: "success", gasUsed: 6_000_000n, transfers: [...got, ...refund], approvals: [] };
}

/** A fake simulator that tells, by `held`, the balances each run gave its sender, oldest first. */
export type RecordingSimulator = Pick<TxSimulator, "simulate"> & {
  readonly held: () => readonly (readonly Amount[])[];
};

/**
 * The fake simulator Brew's tests run a launch's steps on: approvals pass, and `launch` calls go
 * as the dry run says.
 */
export function launchSimulator(run: DryRun = "runs"): RecordingSimulator {
  const held: (readonly Amount[])[] = [];
  const stepOf = (draft: TxDraft): SimulatedStep => {
    const call = decodeEvmDraft(draft);
    const isApproval = call.ok && call.value.data.startsWith("0x095ea7b3");
    if (!call.ok) {
      return { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };
    }
    return isApproval
      ? { status: "success", gasUsed: 50_000n, transfers: [], approvals: [] }
      : createRun(call.value, draft.from, run);
  };
  return {
    held: () => [...held],
    simulate: async (drafts, options) => {
      options.signal.throwIfAborted();
      held.push(options.balances ?? []);
      return Promise.resolve(drafts.map(stepOf));
    },
  };
}

/** Brew's launcher on BSC over the fake factory and a fake simulator, against BNB, USDT and BTCB. */
export function launcherOver(
  simulator: Pick<TxSimulator, "simulate"> = launchSimulator(),
  script: FactoryScript = {},
): NonNullable<Venue["launcher"]> {
  const pairs = [
    { asset: bnb, decimals: 18, startBase: parseEther("8") },
    { asset: usdt, decimals: 18, startBase: parseEther("5000") },
    { asset: btcb, decimals: 18 },
  ];
  const chain = { chain: bscChain, rpc: factoryChain(script), simulator, pairs };
  const venue = createBrewVenue({
    chains: [{ chain: bscChain, nativeAsset: bnb, wrappedNative: wbnb }],
    launches: { random: createSeededRandom(283), chains: [chain] },
  });
  if (venue.launcher === undefined) {
    throw new Error("The venue launches no token.");
  }
  return venue.launcher;
}

/** The fee recipient of {@link testLaunch}, an address outside the install. */
export const testRecipient: AccountRef = at("0x00000000000000000000000000000000000000AA");

/** A 64 by 48 PNG's header, the owner's small picture. */
export const testPicture: LaunchPinRequest["image"] = {
  contentType: "image/png",
  bytes: new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    64, 0, 0, 0, 48, 8, 6, 0, 0, 0,
  ]),
};

/** A launch against BNB with a 0.1 BNB first buy and an 8 BNB start, for the launch wallet. */
export const testLaunch: LaunchPinRequest = {
  wallet: launchWallet,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: bnb,
  firstBuy: { asset: bnb, base: parseEther("0.1") },
  options: {
    poolFeeRecipient: testRecipient,
    holderRewards: false,
    startMarketCap: parseEther("8").toString(),
    poolFee: "onePercent",
    liquidity: "oneRange",
  },
  contracts: launchContracts,
  description: "A cat on the moon",
  links: { website: "https://moon.example", x: "https://x.com/mooncat" },
  image: testPicture,
};
