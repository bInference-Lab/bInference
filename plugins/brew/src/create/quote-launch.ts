import {
  type AccountRef,
  accountRefParts,
  err,
  type LaunchQuote,
  type LaunchOptionValue,
  type LaunchQuoteFailure,
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
// any of what it spent back, as a first buy past the pool's liquidity would, gets none.
function receivedOf(
  create: SimulatedStep,
  of: { readonly wallet: Address; readonly token: Address; readonly pair: string },
): bigint {
  const { wallet, token, pair } = of;
  const toWallet = create.transfers.filter((item) => addressPart(item.to) === wallet);
  if (toWallet.some((item) => item.amount.asset === pair)) {
    return 0n;
  }
  const isToken = (asset: string) => asset.toLowerCase().endsWith(token.toLowerCase());
  return toWallet
    .filter((item) => isToken(item.amount.asset))
    .reduce((sum, item) => sum + item.amount.base, 0n);
}

/**
 * What a launch's first buy gets: its steps run unsent on the chain's simulator at the latest
 * block, from a wallet that holds only the fee and the first buy, with a fresh salt. A run that
 * fails, that refunds part of the first buy, or that gets none of the new token gets 0.
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
    return 0n;
  }
  const { name, symbol } = terms;
  const created = { factory: placed.factory, creator: wallet, name, symbol, metadataURI };
  const token = tokenAddressOf({ ...created, totalSupply: tokenSupply }, salt);
  return receivedOf(create, { wallet, token, pair: terms.pair });
}

/**
 * A launch's start: its market cap, the pool's tick for it, and the settings the quote worked out
 * for it: none for the owner's start, the market cap for the pair's fixed one, and its basis too
 * for one from the pair's USD price.
 */
interface Start {
  readonly marketCap: bigint;
  readonly initialTick: number;
  readonly settings: Readonly<Record<string, string>>;
}

// The settings the quote worked out for a start the owner did not set.
function workedOutOf(
  given: LaunchOptionValue | undefined,
  marketCap: bigint,
  placed: PlacedLaunch,
): Readonly<Record<string, string>> {
  if (typeof given === "string") {
    return {};
  }
  const start = { startMarketCap: marketCap.toString() };
  return placed.pair.startBase === undefined ? { ...start, startBasis: "usdPrice" } : start;
}

// The owner's start, else the pair's default (decision 0283): `start_unpriced` with neither, and
// `start_unreachable` for one no tick reaches.
function startOf(
  terms: LaunchTerms,
  placed: PlacedLaunch,
): Result<Start, "start_unpriced" | "start_unreachable"> {
  const given = terms.options["startMarketCap"];
  const marketCap =
    typeof given === "string" ? BigInt(given) : defaultStartOf(placed.pair, terms.pairUsdPrice);
  if (marketCap === undefined) {
    return err("start_unpriced");
  }
  const start = { marketCapBase: marketCap, supplyBase: tokenSupply, spacing: tickSpacing };
  const initialTick = startTickOf(start);
  return initialTick === undefined
    ? err("start_unreachable")
    : ok({ marketCap, initialTick, settings: workedOutOf(given, marketCap, placed) });
}

/**
 * Quotes a Brew launch at the latest block, nothing uploaded (decision 0283): it reads the
 * factory's launch fee and pause, works out the starting market cap when the owner set none, and
 * for a first buy runs the launch's own steps unsent to read what it gets. Each refusal names the
 * owner's next step (decision 0284): a chain or pair the venue does not launch on is `no_route`,
 * paused launches `launch_paused`, a pair with no start `start_unpriced`, a start no tick reaches
 * `start_unreachable`, and a dry run that fails, refunds or gets none of the token
 * `dry_run_failed`.
 */
export async function quoteLaunch(
  terms: LaunchTerms,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<Result<LaunchQuote, LaunchQuoteFailure>> {
  signal.throwIfAborted();
  const placed = placeOf(terms, parts);
  if (placed === undefined) {
    return err("no_route");
  }
  const start = startOf(terms, placed);
  if (!start.ok) {
    return start;
  }
  const factory = await readFactory(placed, signal);
  if (factory.isPaused) {
    return err("launch_paused");
  }
  checkFirstBuy(terms);
  const fee = { asset: placed.chain.setup.nativeAsset, base: factory.fee };
  const { initialTick } = start.value;
  const settings =
    Object.keys(start.value.settings).length === 0 ? {} : { settings: start.value.settings };
  if (terms.firstBuy === undefined) {
    return ok({ fee, tokenDecimals, ...settings });
  }
  const launch = { placed, fee: factory.fee, initialTick, parts };
  const firstBuyOut = await firstBuyOutOf(terms, launch, signal);
  return firstBuyOut === 0n
    ? err("dry_run_failed")
    : ok({ fee, tokenDecimals, firstBuyOut, ...settings });
}
