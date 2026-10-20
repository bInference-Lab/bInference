import {
  type Amount,
  BinferenceError,
  err,
  type LaunchQuote,
  type LaunchTerms,
  ok,
  type Result,
  type SimulatedStep,
} from "@binference/plugin-sdk";
import { curveAssetOf } from "@binference/plugin-sdk/evm";
import { bytesToHex } from "viem";
import type { LaunchParts } from "./launch-parts.js";
import { checkFirstBuy, launchStepsOf, placeOf } from "./launch-steps.js";
import { findTaxTokenSalt } from "./vanity-salt.js";

// Every Flap token has 18 decimals: a supply of one billion in base units of 10^18.
const tokenDecimals = 18;

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "flap.quote_failed", message });
}

// What the steps' sender holds for the dry run: what the first buy spends, nothing more.
function heldFor(terms: LaunchTerms): readonly Amount[] {
  return terms.firstBuy === undefined || terms.firstBuy.base === 0n ? [] : [terms.firstBuy];
}

// EVM addresses match in any case.
const same = (one: string, two: string): boolean => one.toLowerCase() === two.toLowerCase();

function receivedOf(step: SimulatedStep, terms: LaunchTerms, token: Amount["asset"]): bigint {
  return step.transfers
    .filter(({ to, amount }) => same(to, terms.wallet) && same(amount.asset, token))
    .reduce((sum, transfer) => sum + transfer.amount.base, 0n);
}

/**
 * Quotes a Flap launch from the Portal at the latest block, nothing uploaded: it runs the launch's
 * own steps unsent on the chain's simulator, with a salt found for the run and a stand-in for the
 * metadata, from a wallet that holds only the first buy's spend. The create call must succeed
 * with no value beyond the first buy, which shows the Portal takes no launch fee, and the first buy
 * is what the wallet receives of the new token. A pair Flap does not launch against here is
 * `no_route`; a dry run that reverts throws `flap.quote_failed`.
 */
export async function quoteLaunch(
  terms: LaunchTerms,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<Result<LaunchQuote, "no_route">> {
  signal.throwIfAborted();
  const placed = placeOf(terms, parts);
  if (placed === undefined) {
    return err("no_route");
  }
  checkFirstBuy(terms);
  const found = await findTaxTokenSalt(placed.maker, { random: parts.random, signal });
  // The metadata is uploaded only after the policy; the dry run names a stand-in no token uses.
  const meta = `binference-quote-${bytesToHex(parts.random.bytes(16)).slice(2)}`;
  const { token, steps } = launchStepsOf(terms, placed, { meta, salt: found.salt });
  const { setup, simulator } = placed.chain;
  const run = await simulator.simulate(steps, { signal, balances: heldFor(terms) });
  const create = run.at(-1);
  if (create === undefined || run.some((step) => step.status !== "success")) {
    throw refuse("Flap's Portal refused the launch in a dry run at the latest block.");
  }
  const fee = { asset: setup.nativeAsset, base: 0n };
  if (terms.firstBuy === undefined) {
    return ok({ fee, tokenDecimals });
  }
  const firstBuyOut = receivedOf(create, terms, curveAssetOf(token, setup));
  if (firstBuyOut === 0n) {
    throw refuse("The first buy got none of the new token in a dry run.");
  }
  return ok({ fee, tokenDecimals, firstBuyOut });
}
