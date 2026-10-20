import {
  BinferenceError,
  err,
  type LaunchQuote,
  type LaunchTerms,
  ok,
  type Result,
  writtenWordsOf,
} from "@binference/plugin-sdk";
import { bytesToHex } from "viem";
import type { LaunchParts } from "./launch-parts.js";
import { checkFirstBuy, dryRunLaunch, launchStepsOf, placeOf, readStack } from "./launch-steps.js";

// Every Genius.fun token has 18 decimals: a supply of one billion in base units of 10^18.
const tokenDecimals = 18;

// The least first buy minimum a dry run writes: the router takes none of 0.
const dryRunMinimum = 1n;

/**
 * Quotes a Genius.fun launch on the m4.2 stack at the latest block, nothing uploaded: it reads the
 * factory's launch fee and economics, then runs the launch's own steps unsent on the chain's
 * simulator with a fresh salt, from a wallet that holds only the fee and the first buy. The first
 * buy's output is what the wallet receives of the new token. A pair the venue does not launch
 * against, one the factory does not approve, or a stack closed to launches or to this wallet is
 * `no_route`; a dry run that fails throws.
 */
export async function quoteLaunch(
  terms: LaunchTerms,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<Result<LaunchQuote, "no_route">> {
  signal.throwIfAborted();
  const placed = placeOf(terms, parts);
  const read = placed === undefined ? undefined : await readStack(terms, placed, signal);
  if (placed === undefined || read?.isOpen !== true || !read.isPair) {
    return err("no_route");
  }
  checkFirstBuy(terms);
  const { setup } = placed.chain;
  const write = {
    fee: read.fee,
    economics: read.economics,
    salt: bytesToHex(parts.random.bytes(32)),
    // The words do not change what the launch costs or gets; the build writes the card's.
    words: writtenWordsOf({}),
    minimum: dryRunMinimum,
  };
  const steps = launchStepsOf(terms, placed, write);
  const run = await dryRunLaunch(terms, { placed, steps, fee: read.fee }, signal);
  const fee = { asset: setup.nativeAsset, base: read.fee };
  if (terms.firstBuy === undefined) {
    return ok({ fee, tokenDecimals });
  }
  if (run.received === 0n) {
    throw new BinferenceError({
      code: "geniusfun.dry_run_failed",
      message: "The first buy got none of the new token in a dry run.",
    });
  }
  return ok({ fee, tokenDecimals, firstBuyOut: run.received });
}
