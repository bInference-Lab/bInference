import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  type DecodedLaunch,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveAssetOf, curvePairTokenOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { zeroAddress } from "viem";
import { builtKeyOf } from "./built-key.js";
import { type CreateFirstBuy, readCreateCall } from "./create-call.js";
import type { LaunchParts } from "./launch-parts.js";

// The first buy a create call makes, in the pair, for the recipient it names; none without one.
function firstBuyOf(
  bought: CreateFirstBuy | undefined,
  on: { readonly pair: AssetRef; readonly account: (address: string) => AccountRef },
): Pick<DecodedLaunch, "firstBuy"> {
  return bought === undefined
    ? {}
    : {
        firstBuy: {
          spend: { asset: on.pair, base: bought.quoteIn },
          minOut: bought.minimum,
          recipient: on.account(bought.recipient),
        },
      };
}

// A create call of this venue the launcher built on a chain it launches on, with the token the
// build named; any other draft: undefined.
function builtCallOf(draft: TxDraft, parts: LaunchParts) {
  const chain = parts.chains.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const read = call.ok ? readCreateCall(call.value.data) : undefined;
  const token =
    chain === undefined || !call.ok
      ? undefined
      : parts.built.get(builtKeyOf(chain.setup.chain, call.value));
  return chain === undefined || !call.ok || read === undefined || token === undefined
    ? undefined
    : { setup: chain.setup, call: call.value, read, token };
}

/**
 * Reads what a Genius.fun create call does from the draft's bytes: the token, which the launcher
 * named when it built that same call, the words and the picture link, the pair, the fee its value
 * pays beyond a coin first buy, the first buy with its minimum and recipient, the creator fee
 * recipient as its account id, and no metadata address, since nothing is uploaded. A draft on a
 * chain the venue does not launch on, a call this venue does not build or that names a pair it
 * does not launch against, a call it never built, or a value below a coin first buy is
 * `unknown_call`.
 */
export function decodeLaunch(
  draft: TxDraft,
  parts: LaunchParts,
): Result<DecodedLaunch, "unknown_call"> {
  const found = builtCallOf(draft, parts);
  if (found === undefined) {
    return err("unknown_call");
  }
  const { setup, call, read, token } = found;
  const { terms, settings } = read;
  const pair = curveAssetOf(terms.pairToken, setup);
  const coinSpend = terms.pairToken === zeroAddress ? (terms.firstBuy?.quoteIn ?? 0n) : 0n;
  if (curvePairTokenOf(pair, setup) === undefined || call.value < coinSpend) {
    return err("unknown_call");
  }
  const account = (address: string) => accountRefSchema.parse(`${draft.chain}:${address}`);
  return ok({
    token: curveAssetOf(token, setup),
    name: terms.name,
    symbol: terms.symbol,
    pair,
    feeBase: call.value - coinSpend,
    ...firstBuyOf(terms.firstBuy, { pair, account }),
    options: {
      creatorFeeRecipient: account(settings.creatorFeeRecipient),
      pictureLink: settings.pictureLink,
    },
    words: terms.words,
  });
}
