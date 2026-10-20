import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type LaunchTerms,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curvePairTokenOf, encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, type Hex, zeroAddress } from "viem";
import { portalOf } from "../flap-assets.js";
import { newTokenCallData } from "../portal/launch-call.js";
import { newTokenArgsFor } from "./create-call.js";
import type { LaunchChain, LaunchParts } from "./launch-parts.js";
import { flapSettingsOf } from "./launch-settings.js";
import { type TokenMaker, tokenAddressOf } from "./vanity-salt.js";

/** A launch the venue can make: its chain, the Portal and the pair as the Portal names them. */
export interface PlacedLaunch {
  readonly chain: LaunchChain;
  readonly maker: TokenMaker;
  readonly quoteToken: Address;
}

/** Where a launch's terms place it; a chain Flap does not launch on, or another pair: undefined. */
export function placeOf(terms: LaunchTerms, parts: LaunchParts): PlacedLaunch | undefined {
  const chain = parts.chains.get(accountRefParts(terms.wallet).chain);
  const quoteToken = chain === undefined ? undefined : curvePairTokenOf(terms.pair, chain.setup);
  if (chain === undefined || quoteToken === undefined) {
    return undefined;
  }
  const maker = { portal: portalOf(terms.contracts), implementation: chain.implementation };
  return { chain, maker, quoteToken };
}

/** A first buy that spends another asset than the pair is a fault of the caller. */
export function checkFirstBuy(terms: LaunchTerms): void {
  if (terms.firstBuy !== undefined && terms.firstBuy.asset !== terms.pair) {
    throw new BinferenceError({
      code: "flap.bad_launch",
      message: "A Flap launch's first buy spends the asset its token trades against.",
    });
  }
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
