import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  BinferenceError,
  type LaunchTerms,
  type SimulatedStep,
  type TxDraft,
  type WrittenWords,
} from "@binference/plugin-sdk";
import {
  curvePairTokenOf,
  curveTokenOf,
  encodeEvmApproval,
  encodeEvmDraft,
  parseEvmAddress,
} from "@binference/plugin-sdk/evm";
import { type Address, type Hex, zeroAddress } from "viem";
import { createCallData, type LaunchTermsRead, readLaunchTerms } from "../contracts/launch-call.js";
import { addressOf, launchStackOf } from "../geniusfun-contracts.js";
import { createCallFor } from "./create-call.js";
import type { LaunchChain, LaunchParts } from "./launch-parts.js";
import { geniusfunSettingsOf } from "./launch-settings.js";

/** A launch the venue can make: its chain, the stack's factory and router, and the pair. */
export interface PlacedLaunch {
  readonly chain: LaunchChain;
  readonly factory: AccountRef;
  readonly router: AccountRef;
  readonly pairToken: Address;
}

/** Where a launch's terms place it; a chain the venue does not launch on, or another pair: undefined. */
export function placeOf(terms: LaunchTerms, parts: LaunchParts): PlacedLaunch | undefined {
  const chain = parts.chains.get(accountRefParts(terms.wallet).chain);
  const pairToken = chain === undefined ? undefined : curvePairTokenOf(terms.pair, chain.setup);
  return chain === undefined || pairToken === undefined
    ? undefined
    : { chain, ...launchStackOf(terms.contracts), pairToken };
}

// The one launch configuration the factory offers.
const launchConfigId = 0n;

/**
 * Reads, at the latest block, the launch stack's fee, whether it launches now from the wallet,
 * whether it takes the pair, and the economics digest a launch commits to.
 */
export async function readStack(
  terms: LaunchTerms,
  placed: PlacedLaunch,
  signal: AbortSignal,
): Promise<LaunchTermsRead> {
  return readLaunchTerms(
    { rpc: placed.chain.setup.rpc, signal },
    {
      factory: addressOf(placed.factory),
      wallet: addressOf(terms.wallet),
      pairToken: placed.pairToken,
      configId: launchConfigId,
    },
  );
}

/** A first buy that spends another asset than the pair is a fault of the caller. */
export function checkFirstBuy(terms: LaunchTerms): void {
  if (terms.firstBuy !== undefined && terms.firstBuy.asset !== terms.pair) {
    throw new BinferenceError({
      code: "geniusfun.bad_launch",
      message: "A Genius.fun launch's first buy spends the asset its token trades against.",
    });
  }
}

/** What a launch's create call writes beyond its terms: the fee, the economics, the salt. */
export interface LaunchWrite {
  readonly fee: bigint;
  readonly economics: Hex;
  readonly salt: Hex;
  readonly words: WrittenWords;
  /** The least of the new token the first buy takes; given with a first buy alone. */
  readonly minimum?: bigint;
}

// The first buy as the router takes it, for the wallet; none without one.
function firstBuyOf(terms: LaunchTerms, write: LaunchWrite) {
  const { firstBuy } = terms;
  if (firstBuy === undefined) {
    return undefined;
  }
  return {
    quoteIn: firstBuy.base,
    minimum: write.minimum ?? 0n,
    recipient: addressOf(terms.wallet),
  };
}

/**
 * A launch's steps from its wallet. With a first buy: an exact approval of the router for a token
 * first buy, then one `launchAndBuy` call to the router, whose value is the launch fee and a coin
 * first buy. With none: one `launchToken` call to the factory, whose value is the launch fee, also
 * for a launch against a token.
 */
export function launchStepsOf(
  terms: LaunchTerms,
  placed: PlacedLaunch,
  write: LaunchWrite,
): readonly TxDraft[] {
  const firstBuy = firstBuyOf(terms, write);
  const call = createCallFor(
    {
      name: terms.name,
      symbol: terms.symbol,
      words: write.words,
      pairToken: placed.pairToken,
      economics: write.economics,
      salt: write.salt,
      ...(firstBuy === undefined ? {} : { firstBuy }),
    },
    geniusfunSettingsOf(terms.options),
  );
  const isCoin = placed.pairToken === zeroAddress;
  const coinSpend = isCoin ? (firstBuy?.quoteIn ?? 0n) : 0n;
  const create = encodeEvmDraft({
    from: terms.wallet,
    to: firstBuy === undefined ? placed.factory : placed.router,
    value: write.fee + coinSpend,
    data: createCallData(call),
  });
  if (firstBuy === undefined || isCoin) {
    return [create];
  }
  const approval = encodeEvmApproval({
    wallet: terms.wallet,
    token: placed.pairToken,
    spender: addressOf(placed.router),
    amountBase: firstBuy.quoteIn,
  });
  return [approval, create];
}

/** What a launch's steps did in a dry run: the token the factory made, and what the wallet got. */
export interface LaunchRun {
  readonly token: Address;
  /** The new token the wallet received from its first buy, in base units. */
  readonly received: bigint;
}

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "geniusfun.dry_run_failed", message });
}

// What the steps' sender holds for the dry run: the fee and the first buy, nothing more.
function heldFor(terms: LaunchTerms, placed: PlacedLaunch, fee: bigint): readonly Amount[] {
  const { nativeAsset } = placed.chain.setup;
  const { firstBuy } = terms;
  const coinSpend = placed.pairToken === zeroAddress ? (firstBuy?.base ?? 0n) : 0n;
  const coin = { asset: nativeAsset, base: fee + coinSpend };
  return firstBuy === undefined || placed.pairToken === zeroAddress ? [coin] : [coin, firstBuy];
}

const addressPart = (account: AccountRef): Address | undefined => {
  const address = parseEvmAddress(accountRefParts(account).address);
  return address.ok ? address.value : undefined;
};

// The token the create call made: the one the zero address minted, which is never the pair.
function mintedOf(step: SimulatedStep, placed: PlacedLaunch): Address | undefined {
  const { setup } = placed.chain;
  const minted = step.transfers
    .filter((transfer) => addressPart(transfer.from) === zeroAddress)
    .map((transfer) => curveTokenOf(transfer.amount.asset, setup))
    .filter((token) => token !== undefined && token !== zeroAddress && token !== placed.pairToken);
  const [token, ...others] = new Set(minted);
  return others.length === 0 ? token : undefined;
}

/**
 * Runs a launch's steps unsent on the chain's simulator at the latest block, from a wallet that
 * holds only the fee and the first buy: every step must succeed, the factory must mint one new
 * token, and the wallet must get back none of what it spent, which a first buy that completes the
 * curve would refund. A run that does otherwise throws `geniusfun.dry_run_failed`.
 */
export async function dryRunLaunch(
  terms: LaunchTerms,
  launch: {
    readonly placed: PlacedLaunch;
    readonly steps: readonly TxDraft[];
    readonly fee: bigint;
  },
  signal: AbortSignal,
): Promise<LaunchRun> {
  const { placed, steps, fee } = launch;
  const { simulator, setup } = placed.chain;
  const run = await simulator.simulate(steps, { signal, balances: heldFor(terms, placed, fee) });
  const create = run.at(-1);
  if (create === undefined || run.some((step) => step.status !== "success")) {
    throw refuse("Genius.fun's contracts refused the launch in a dry run at the latest block.");
  }
  const token = mintedOf(create, placed);
  if (token === undefined) {
    throw refuse("The launch made no single new token in a dry run.");
  }
  const wallet = addressPart(terms.wallet);
  const toWallet = create.transfers.filter((transfer) => addressPart(transfer.to) === wallet);
  const sent = (asset: AssetRef) => curveTokenOf(asset, setup);
  if (toWallet.some((transfer) => sent(transfer.amount.asset) === placed.pairToken)) {
    throw refuse("The first buy would complete the curve, which refunds part of it.");
  }
  const received = toWallet
    .filter((transfer) => sent(transfer.amount.asset) === token)
    .reduce((sum, transfer) => sum + transfer.amount.base, 0n);
  return { token, received };
}
