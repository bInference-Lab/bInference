import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  err,
  type LaunchQuote,
  type LaunchTerms,
  ok,
  type Result,
  type SimulatedStep,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { type Address, bytesToHex } from "viem";
import { launchFeeData, launchFeeOf, pausedData, pausedOf } from "../contracts/launch-call.js";
import { readBrew } from "../contracts/read-brew.js";
import { tokenAddressOf } from "./brew-token.js";
import { launchMetadataOf } from "./launch-metadata.js";
import type { LaunchParts } from "./launch-parts.js";
import {
  addressOf,
  checkFirstBuy,
  defaultStartOf,
  heldFor,
  launchStepsOf,
  type PlacedLaunch,
  placeOf,
  tickSpacing,
  tokenSupply,
} from "./launch-steps.js";
import { startTickOf } from "./start-tick.js";

// Every Brew token has 18 decimals.
const tokenDecimals = 18;

// The least first buy minimum a dry run writes; the build writes the host's.
const dryRunMinimum = 1n;

// A picture a dry run's metadata names: what a launch costs and gets does not depend on it.
const dryRunPicture = { contentType: "image/png", bytes: new Uint8Array([0x89]) };

/** What the factory says of launching now: its fee, and whether new launches are paused. */
export interface FactoryState {
  readonly fee: bigint;
  readonly isPaused: boolean;
}

/** Reads BrewFactory's launch fee and pause at the latest block. */
export async function readFactory(
  placed: PlacedLaunch,
  signal: AbortSignal,
): Promise<FactoryState> {
  const read = { rpc: placed.chain.rpc, signal };
  const to = placed.factory;
  const [fee, isPaused] = await Promise.all([
    readBrew(read, { to, data: launchFeeData, what: "the launch fee" }, launchFeeOf),
    readBrew(read, { to, data: pausedData, what: "the pause" }, pausedOf),
  ]);
  return { fee, isPaused };
}

const addressPart = (account: AccountRef): Address | undefined => {
  const address = parseEvmAddress(accountRefParts(account).address);
  return address.ok ? address.value : undefined;
};

// What of the new token the wallet received in the create call's run; a run that sends the wallet
// any of what it spent back, as a first buy past the pool's liquidity would, throws.
function receivedOf(
  create: SimulatedStep,
  of: { readonly wallet: Address; readonly token: Address; readonly pair: string },
): bigint {
  const { wallet, token, pair } = of;
  const toWallet = create.transfers.filter((item) => addressPart(item.to) === wallet);
  if (toWallet.some((item) => item.amount.asset === pair)) {
    throw new BinferenceError({
      code: "brew.dry_run_failed",
      message: "The first buy would sweep past the pool's liquidity, which refunds part of it.",
    });
  }
  const isToken = (asset: string) => asset.toLowerCase().endsWith(token.toLowerCase());
  return toWallet
    .filter((item) => isToken(item.amount.asset))
    .reduce((sum, item) => sum + item.amount.base, 0n);
}

/**
 * What a launch's first buy gets: its steps run unsent on the chain's simulator at the latest
 * block, from a wallet that holds only the fee and the first buy, with a fresh salt. A run that
 * fails, or that gets none of the new token, throws `brew.dry_run_failed`.
 */
async function firstBuyOutOf(
  terms: LaunchTerms,
  launch: {
    readonly placed: PlacedLaunch;
    readonly fee: bigint;
    readonly initialTick: number;
    readonly parts: LaunchParts;
  },
  signal: AbortSignal,
): Promise<bigint> {
  const { placed, fee, initialTick, parts } = launch;
  const metadataURI = launchMetadataOf({}, dryRunPicture);
  const salt = bytesToHex(parts.random.bytes(32));
  const write = { fee, metadataURI, initialTick, salt, minimum: dryRunMinimum };
  const wallet = addressOf(terms.wallet);
  const steps = launchStepsOf(terms, placed, { ...write, feeRecipient: wallet });
  const balances = heldFor(terms, placed, fee);
  const run = await placed.chain.simulator.simulate(steps, { signal, balances });
  const create = run.at(-1);
  if (create === undefined || run.some((step) => step.status !== "success")) {
    throw new BinferenceError({
      code: "brew.dry_run_failed",
      message: "BrewFactory refused the launch in a dry run at the latest block.",
    });
  }
  const { name, symbol } = terms;
  const created = { factory: placed.factory, creator: wallet, name, symbol, metadataURI };
  const token = tokenAddressOf({ ...created, totalSupply: tokenSupply }, salt);
  const received = receivedOf(create, { wallet, token, pair: terms.pair });
  if (received === 0n) {
    throw new BinferenceError({
      code: "brew.dry_run_failed",
      message: "The first buy got none of the new token in a dry run.",
    });
  }
  return received;
}

/** A launch's start: its market cap, the pool's tick for it, and whether the quote worked it out. */
interface Start {
  readonly marketCap: bigint;
  readonly initialTick: number;
  readonly isWorkedOut: boolean;
}

// The owner's start, else the pair's default (decision 0283); one no tick reaches: undefined.
function startOf(terms: LaunchTerms, placed: PlacedLaunch): Start | undefined {
  const given = terms.options["startMarketCap"];
  const marketCap =
    typeof given === "string" ? BigInt(given) : defaultStartOf(placed.pair, terms.pairUsdPrice);
  if (marketCap === undefined) {
    return undefined;
  }
  const start = { marketCapBase: marketCap, supplyBase: tokenSupply, spacing: tickSpacing };
  const initialTick = startTickOf(start);
  return initialTick === undefined
    ? undefined
    : { marketCap, initialTick, isWorkedOut: typeof given !== "string" };
}

/**
 * Quotes a Brew launch at the latest block, nothing uploaded (decision 0283): it reads the
 * factory's launch fee and pause, works out the starting market cap when the owner set none, and
 * for a first buy runs the launch's own steps unsent to read what it gets. A chain or pair the
 * venue does not launch on, paused launches, a pair with no start, or a start no tick reaches is
 * `no_route`; a dry run that fails throws.
 */
export async function quoteLaunch(
  terms: LaunchTerms,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<Result<LaunchQuote, "no_route">> {
  signal.throwIfAborted();
  const placed = placeOf(terms, parts);
  const start = placed === undefined ? undefined : startOf(terms, placed);
  const factory =
    start === undefined || placed === undefined ? undefined : await readFactory(placed, signal);
  if (placed === undefined || start === undefined || factory?.isPaused !== false) {
    return err("no_route");
  }
  checkFirstBuy(terms);
  const fee = { asset: placed.chain.setup.nativeAsset, base: factory.fee };
  const settings = start.isWorkedOut
    ? { settings: { startMarketCap: start.marketCap.toString() } }
    : {};
  if (terms.firstBuy === undefined) {
    return ok({ fee, tokenDecimals, ...settings });
  }
  const launch = { placed, fee: factory.fee, initialTick: start.initialTick, parts };
  const firstBuyOut = await firstBuyOutOf(terms, launch, signal);
  return ok({ fee, tokenDecimals, firstBuyOut, ...settings });
}
