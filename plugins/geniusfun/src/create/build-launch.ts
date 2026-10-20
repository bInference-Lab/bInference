import {
  BinferenceError,
  type ChainRef,
  type LaunchBuild,
  type LaunchBuildRequest,
  type TxDraft,
  writtenWordsOf,
} from "@binference/plugin-sdk";
import { curveAssetOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, bytesToHex } from "viem";
import { builtKeyOf } from "./built-key.js";
import type { LaunchParts } from "./launch-parts.js";
import { checkFirstBuy, dryRunLaunch, launchStepsOf, placeOf, readStack } from "./launch-steps.js";

// The token a built create call makes, kept for the decoder, by the call itself.
function keepToken(
  parts: LaunchParts,
  built: { readonly chain: ChainRef; readonly steps: readonly TxDraft[]; readonly token: Address },
): void {
  const create = built.steps.at(-1);
  const call = create === undefined ? undefined : decodeEvmDraft(create);
  if (call?.ok === true) {
    parts.built.set(builtKeyOf(built.chain, call.value), built.token);
  }
}

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "geniusfun.no_route", message });
}

/**
 * Builds a Genius.fun launch on the m4.2 stack from the launch wallet: with a first buy, an exact
 * approval of the router for a token first buy, then one `launchAndBuy` call with the host's
 * minimum; with none, one `launchToken` call to the factory. The create call names the card's
 * words, the owner's picture link and creator fee recipient, the factory's economics read now and
 * a fresh salt, and pays the quoted fee. The build names the token at the address a dry run of
 * those steps gives it, and keeps it for the decoder. A launch fee other than the quoted one, a
 * first buy without a minimum, a launch on a chain or pair the venue does not launch against, a
 * stack closed to launches, and a dry run that fails each throw.
 */
export async function buildLaunch(
  request: LaunchBuildRequest,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<LaunchBuild> {
  signal.throwIfAborted();
  checkFirstBuy(request);
  const placed = placeOf(request, parts);
  const minimum = request.firstBuyMinOut;
  if (placed === undefined) {
    throw refuse("Genius.fun launches here only on its chains and pairs.");
  }
  if (request.firstBuy !== undefined && (minimum ?? 0n) === 0n) {
    throw refuse("A first buy on Genius.fun takes a minimum above 0.");
  }
  const read = await readStack(request, placed, signal);
  if (!read.isOpen || !read.isPair || read.fee !== request.fee.base) {
    throw refuse("The stack is closed to the launch, or its fee is no longer the quoted one.");
  }
  const write = {
    fee: read.fee,
    economics: read.economics,
    salt: bytesToHex(parts.random.bytes(32)),
    words: writtenWordsOf(request),
    ...(minimum === undefined ? {} : { minimum }),
  };
  const steps = launchStepsOf(request, placed, write);
  const run = await dryRunLaunch(request, { placed, steps, fee: read.fee }, signal);
  const { setup } = placed.chain;
  keepToken(parts, { chain: setup.chain, steps, token: run.token });
  return { token: curveAssetOf(run.token, setup), steps };
}
