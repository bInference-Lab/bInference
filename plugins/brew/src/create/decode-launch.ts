import {
  type AccountRef,
  accountRefSchema,
  type DecodedLaunch,
  err,
  type LaunchOptionValue,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, getAddress } from "viem";
import { brewAssetOf } from "../brew-setups.js";
import { type LaunchParams, readLaunchCall } from "../contracts/launch-call.js";
import { distributorAddressOf } from "./brew-distributor.js";
import { tokenAddressOf } from "./brew-token.js";
import { type ReadMetadata, readLaunchMetadata } from "./launch-metadata.js";
import {
  type BuiltLaunch,
  builtKeyOf,
  type LaunchChain,
  type LaunchParts,
} from "./launch-parts.js";
import { poolFee, tickSpacing, tokenSupply } from "./launch-steps.js";
import { startTickOf } from "./start-tick.js";

/** A create call of this venue the launcher built, read from its bytes. */
interface ReadCreate {
  readonly chain: LaunchChain;
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly params: LaunchParams;
  readonly metadata: ReadMetadata;
  readonly built: BuiltLaunch;
}

// The call's pool is one the venue writes: a 1% pool of the whole supply in one range from a tick
// the kept start gives, on the spacing.
function isOurPool(read: Omit<ReadCreate, "metadata">): boolean {
  const { params, built } = read;
  const tick = startTickOf({
    marketCapBase: built.startMarketCap,
    supplyBase: tokenSupply,
    spacing: tickSpacing,
  });
  return (
    params.fee === poolFee &&
    params.totalSupply === tokenSupply &&
    params.positions.length === 0 &&
    params.initialTick === tick
  );
}

// A create call the launcher built, from a launch wallet, on a chain it launches on: any other
// draft is undefined.
function readCreate(draft: TxDraft, parts: LaunchParts): ReadCreate | undefined {
  const chain = parts.chains.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const built = parts.built.get(builtKeyOf(draft));
  const params = call.ok ? readLaunchCall(call.value.data) : undefined;
  const metadata = params === undefined ? undefined : readLaunchMetadata(params.metadataURI);
  if (chain === undefined || !call.ok || built === undefined) {
    return undefined;
  }
  if (params === undefined || metadata === undefined) {
    return undefined;
  }
  const { from, to, value } = call.value;
  // A launch call to any contract but the factory that built it is none of this venue's.
  if (getAddress(to) !== getAddress(built.factory)) {
    return undefined;
  }
  const read = { chain, from, to, value, params, built };
  return isOurPool(read) ? { ...read, metadata } : undefined;
}

// The call's value pays its consented fee and a coin first buy; with no first buy, no minimum.
function paysAsWritten(read: ReadCreate, coinSpend: bigint): boolean {
  const { params, value } = read;
  const hasBuy = params.initialBuyQuoteAmount > 0n;
  return (
    value === params.maxLaunchFeeWei + coinSpend && (hasBuy || params.initialBuyMinTokensOut === 0n)
  );
}

// The first buy the call makes, in the pair, for the recipient it names; none without one.
function firstBuyOf(
  params: LaunchParams,
  on: { readonly pair: DecodedLaunch["pair"]; readonly account: (address: Address) => AccountRef },
): Pick<DecodedLaunch, "firstBuy"> {
  const buy = params.initialBuyQuoteAmount;
  return buy === 0n
    ? {}
    : {
        firstBuy: {
          spend: { asset: on.pair, base: buy },
          minOut: params.initialBuyMinTokensOut,
          recipient: on.account(params.initialBuyRecipient),
        },
      };
}

// The settings the call writes: holder rewards when its fee recipient is the token's holder
// distributor, worked out off line from the factories, else that fee recipient; the start the
// kept build's tick came from, and the pool's two words.
function optionsOf(
  read: ReadCreate,
  on: { readonly token: Address; readonly account: (address: Address) => AccountRef },
): Readonly<Record<string, LaunchOptionValue>> {
  const { params, built } = read;
  const factories = { distributorFactory: built.distributorFactory, brewFactory: built.factory };
  const recipient = getAddress(params.creatorFeeRecipient);
  const isHolders = recipient === distributorAddressOf(factories, on.token);
  const options: Record<string, LaunchOptionValue> = {
    holderRewards: isHolders,
    startMarketCap: built.startMarketCap.toString(),
    ...(built.isStartPriced ? { startBasis: "usdPrice" } : {}),
    poolFee: "onePercent",
    liquidity: "oneRange",
  };
  const named = on.account(recipient);
  return isHolders
    ? { ...options, holderDistributor: named }
    : { poolFeeRecipient: named, ...options };
}

/**
 * Reads what a Brew create call does from the draft's bytes (decision 0283): the token, at the
 * address the factory's CREATE2 gives it from the call's words and salt and its sender; the words
 * and the picture in its metadata address, which must be exactly what the launcher writes; the
 * pair, the coin for the wrapped coin; the fee it consents to and pays beyond a coin first buy;
 * the first buy with its minimum and recipient; and every setting. The start comes from the build
 * that made the same call, whose tick the call must write, as must its fee recipient for holder
 * rewards. A draft that is no such call, or a call this venue never built, is `unknown_call`.
 */
export function decodeLaunch(
  draft: TxDraft,
  parts: LaunchParts,
): Result<DecodedLaunch, "unknown_call"> {
  const read = readCreate(draft, parts);
  if (read === undefined) {
    return err("unknown_call");
  }
  const { params, chain, from, to, metadata } = read;
  const { setup } = chain;
  const pair = brewAssetOf(params.quoteToken, setup);
  const coinSpend = pair === setup.nativeAsset ? params.initialBuyQuoteAmount : 0n;
  if (!paysAsWritten(read, coinSpend)) {
    return err("unknown_call");
  }
  const account = (address: Address) => accountRefSchema.parse(`${draft.chain}:${address}`);
  const { name, symbol, totalSupply, metadataURI } = params;
  const created = { factory: to, creator: from, name, symbol, totalSupply, metadataURI };
  const token = tokenAddressOf(created, params.salt);
  return ok({
    token: brewAssetOf(token, setup),
    name,
    symbol,
    picture: metadata.picture,
    pair,
    feeBase: params.maxLaunchFeeWei,
    ...firstBuyOf(params, { pair, account }),
    options: optionsOf(read, { token, account }),
    words: metadata.words,
  });
}
