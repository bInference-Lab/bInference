import {
  type AccountRef,
  type Amount,
  accountRefSchema,
  type DecodedLaunch,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveAssetOf, curvePairTokenOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { zeroAddress } from "viem";
import { newTokenArgsOf } from "../portal/launch-call.js";
import { createOfArgs } from "./create-call.js";
import type { LaunchParts } from "./launch-parts.js";
import { isTaxTokenAddress, tokenAddressOf } from "./vanity-salt.js";

// The create call's first buy for the calling wallet, which carries no minimum; none for no spend.
function firstBuyOf(spend: Amount, recipient: AccountRef): Pick<DecodedLaunch, "firstBuy"> {
  return spend.base === 0n ? {} : { firstBuy: { spend, minOut: 0n, recipient } };
}

/**
 * Reads what a Flap create call does from the draft's bytes alone: the token at the address the
 * draft's Portal gives its salt, the words, the metadata's CID, the pair, the fee the value pays
 * beyond a coin first buy, the first buy for the calling wallet with no minimum (decision 0270),
 * and every setting, the tax recipient as its account id. A draft on a chain Flap does not launch
 * on, a call this venue does not build, a pair it does not launch against, a token address that
 * does not end in 7777, or a value below a coin first buy is `unknown_call`.
 */
export function decodeLaunch(
  draft: TxDraft,
  parts: LaunchParts,
): Result<DecodedLaunch, "unknown_call"> {
  const chain = parts.chains.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const args = call.ok ? newTokenArgsOf(call.value.data) : undefined;
  const create = args === undefined ? undefined : createOfArgs(args);
  if (chain === undefined || !call.ok || create === undefined) {
    return err("unknown_call");
  }
  const { setup } = chain;
  const { terms, settings } = create;
  const token = tokenAddressOf(
    { portal: call.value.to, implementation: chain.implementation },
    terms.salt,
  );
  const coinSpend = terms.quoteToken === zeroAddress ? terms.quoteAmt : 0n;
  const isPair = curvePairTokenOf(curveAssetOf(terms.quoteToken, setup), setup) !== undefined;
  if (!isPair || !isTaxTokenAddress(token) || call.value.value < coinSpend) {
    return err("unknown_call");
  }
  const pair = curveAssetOf(terms.quoteToken, setup);
  const account = (address: string) => accountRefSchema.parse(`${draft.chain}:${address}`);
  const firstBuy = firstBuyOf({ asset: pair, base: terms.quoteAmt }, account(call.value.from));
  return ok({
    token: curveAssetOf(token, setup),
    name: terms.name,
    symbol: terms.symbol,
    metadataUri: terms.meta,
    pair,
    feeBase: call.value.value - coinSpend,
    ...firstBuy,
    options: { ...settings, taxRecipient: account(settings.taxRecipient) },
  });
}
