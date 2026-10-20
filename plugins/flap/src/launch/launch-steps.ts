import {
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  type LaunchTerms,
  type TxDraft,
} from "@binference/plugin-sdk";
import {
  type CurveChainSetup,
  curveTokenOf,
  encodeEvmApproval,
  encodeEvmDraft,
} from "@binference/plugin-sdk/evm";
import { type Address, type Hex, zeroAddress } from "viem";
import { portalOf } from "../flap-assets.js";
import { newTokenCallData } from "../portal/launch-call.js";
import { newTokenArgsFor } from "./create-call.js";
import type { LaunchChain, LaunchParts } from "./launch-parts.js";
import { flapSettingsOf } from "./launch-settings.js";
import { type TokenMaker, tokenAddressOf } from "./vanity-salt.js";

/**
 * The pair as the Portal names it: the zero address for the chain's coin, else a quote token the
 * registry lists for Flap's curves. Any other asset: undefined.
 */
export function pairTokenOf(pair: AssetRef, setup: CurveChainSetup): Address | undefined {
  const token = curveTokenOf(pair, setup);
  return token === zeroAddress || (token !== undefined && setup.quoteTokens.has(token))
    ? token
    : undefined;
}

/** A launch the venue can make: its chain, the Portal and the pair as the Portal names them. */
export interface PlacedLaunch {
  readonly chain: LaunchChain;
  readonly maker: TokenMaker;
  readonly quoteToken: Address;
}

/** Where a launch's terms place it; a chain Flap does not launch on, or another pair: undefined. */
export function placeOf(terms: LaunchTerms, parts: LaunchParts): PlacedLaunch | undefined {
  const chain = parts.chains.get(accountRefParts(terms.wallet).chain);
  const quoteToken = chain === undefined ? undefined : pairTokenOf(terms.pair, chain.setup);
  if (chain === undefined || quoteToken === undefined) {
    return undefined;
  }
  const maker = { portal: portalOf(terms.contracts), implementation: chain.implementation };
  return { chain, maker, quoteToken };
}

/** The steps of a launch with its metadata and salt, and the token its create call makes. */
export interface LaunchSteps {
  readonly token: Address;
  readonly steps: readonly TxDraft[];
}

/**
 * A launch's steps from its wallet: an exact approval of the Portal for a token first buy, then
 * the one `newTokenV6` call, which carries the coin first buy as its value. The Portal takes no
 * launch fee on this call, so a coin first buy is the whole value.
 */
export function launchStepsOf(
  terms: LaunchTerms,
  placed: PlacedLaunch,
  written: { readonly meta: string; readonly salt: Hex },
): LaunchSteps {
  const { maker, quoteToken, chain } = placed;
  const quoteAmt = terms.firstBuy?.base ?? 0n;
  const create = encodeEvmDraft({
    from: terms.wallet,
    to: accountRefSchema.parse(`${chain.setup.chain}:${maker.portal}`),
    value: quoteToken === zeroAddress ? quoteAmt : 0n,
    data: newTokenCallData(
      newTokenArgsFor(
        { name: terms.name, symbol: terms.symbol, ...written, quoteToken, quoteAmt },
        flapSettingsOf(terms.options),
      ),
    ),
  });
  const token = tokenAddressOf(maker, written.salt);
  if (quoteToken === zeroAddress || quoteAmt === 0n) {
    return { token, steps: [create] };
  }
  const approval = encodeEvmApproval({
    wallet: terms.wallet,
    token: quoteToken,
    spender: maker.portal,
    amountBase: quoteAmt,
  });
  return { token, steps: [approval, create] };
}
