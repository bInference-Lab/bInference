import {
  type AccountRef,
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  type PriceSource,
  type Signer,
} from "@binference/chain";
import { BinferenceError, type Ratio } from "@binference/core";
import type { BuyRequest, FillSize, SellRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { OrderSkipReason, QuoteFailure } from "../intents/intent-reason.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { Holdings } from "../money-path/wallet-facts.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { fillLimitBase, type SizeFacts } from "./fill-bounds.js";
import type { OrderRecord } from "./order-record.js";

/** What a fill is sized from: what the wallet holds, the gas reserve and USD prices. */
export interface FillSizeParts {
  readonly holdings: Holdings;
  readonly custody: Pick<Signer, "account">;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
}

/** A fill's intent request, and the most it may spend, as sized when its trigger fired. */
export interface SizedFill {
  readonly kind: "sized";
  readonly request: BuyRequest | SellRequest;
  readonly limitBase: bigint;
}

/**
 * What sizing a fill came to: its request; a skip before any intent, with its reason; or a sale's
 * position that holds none of the token, which ends the exit order (spec 6, section 5).
 */
export type FillSizing =
  | SizedFill
  | {
      readonly kind: "skip";
      readonly reason:
        | OrderSkipReason
        | Extract<QuoteFailure, "nothing_to_sell" | "balance_unread">
        | "no_price";
    }
  | { readonly kind: "empty" };

interface Sizing {
  readonly order: OrderRecord;
  readonly settings: AgentSettings;
  /** Micro-dollars for one base unit of the order's token at the trigger; none for a DCA buy. */
  readonly tokenUsd?: Ratio;
  readonly signal: AbortSignal;
}

// The wallet's account on the token's chain, which custody must hold.
async function accountOf(parts: FillSizeParts, sizing: Sizing): Promise<AccountRef> {
  const { order, signal } = sizing;
  const chain = assetRefParts(order.request.token).chain;
  const account = await parts.custody.account(order.walletId, chain, { signal });
  if (!account.ok) {
    throw new BinferenceError({
      code: "engine.fill_wallet",
      message: `Custody holds no account of order ${order.id}'s wallet on its chain.`,
      details: { order: order.id },
    });
  }
  return account.value;
}

// The USD price of an asset, or `undefined` when nothing prices it.
async function usdOf(
  parts: FillSizeParts,
  asset: AssetRef,
  signal: AbortSignal,
): Promise<Ratio | undefined> {
  const price = await parts.prices.usdPrice(asset, { signal });
  return price.ok && isUsablePrice(price.value) ? price.value : undefined;
}

// What a buy sized in dollars counts them at: its asset's USD price; a buy by amount or share needs
// none.
async function dollarPriceOf(
  parts: FillSizeParts,
  call: { readonly asset: AssetRef; readonly size: FillSize; readonly signal: AbortSignal },
): Promise<Ratio | undefined> {
  return "usdMicros" in call.size ? usdOf(parts, call.asset, call.signal) : undefined;
}

// The chain's coin of the order's token's chain, which a buy spends when its order names nothing.
function coinOf(parts: FillSizeParts, order: OrderRecord): AssetRef {
  const chain = parts.chains.get(assetRefParts(order.request.token).chain);
  if (!chain.ok) {
    throw new BinferenceError({
      code: "engine.fill_chain",
      message: `Order ${order.id} names a token on a chain the registry does not hold.`,
      details: { order: order.id },
    });
  }
  return nativeAssetOf(chain.value);
}

// What the wallet holds of what the fill spends, the coin a buy of the coin keeps for network
// fees, and the price a size in dollars is counted at: a buy's asset's, a sale's trigger price.
// `undefined` when the balance read had no entry for what the fill spends, which is no data.
async function sizeFacts(
  parts: FillSizeParts,
  sizing: Sizing,
  spent: { readonly asset: AssetRef; readonly coin: AssetRef; readonly account: AccountRef },
): Promise<SizeFacts | undefined> {
  const { order, settings, signal } = sizing;
  const { asset, coin, account } = spent;
  const { side, size } = order.request;
  const query = { wallet: order.walletId, account, isPaper: order.isPaper, asset };
  const heldBase = await parts.holdings.held(query, { signal });
  if (heldBase === undefined) {
    return undefined;
  }
  const chain = assetRefParts(coin).chain;
  const reserve = settings.limits.gasReserve.find((entry) => entry.chain === chain);
  const keptBase = side === "buy" && asset === coin ? (reserve?.reserveBase ?? 0n) : 0n;
  const spendUsd =
    side === "sell" ? sizing.tokenUsd : await dollarPriceOf(parts, { asset, size, signal });
  return { side, heldBase, keptBase, ...(spendUsd === undefined ? {} : { spendUsd }) };
}

// The fill's request: a buy or a sale of the order's token in its wallet, with its slippage. A sale
// by share keeps its share, which the money path takes of what the wallet holds as its quote is
// built (invariant 15). A buy by share spends the base its share came to here, at sizing: the
// money path has no share of what a buy spends. The gap is the few milliseconds between sizing and
// the quote inside the agent's line of fills, which runs no other fill of the agent; a buy that
// spends more than the wallet then holds fails its simulation, on paper as on chain.
function requestOf(
  order: OrderRecord,
  terms: { readonly spend: AssetRef; readonly limitBase: bigint },
): BuyRequest | SellRequest {
  const { request } = order;
  const base = {
    agent: order.agentId,
    wallet: order.walletId,
    token: request.token,
    reason: request.reason ?? order.id,
    ...(request.maxSlippageBps === undefined ? {} : { maxSlippageBps: request.maxSlippageBps }),
  };
  const { size } = request;
  return request.side === "buy"
    ? { ...base, kind: "buy" as const, spend: { asset: terms.spend, base: terms.limitBase } }
    : {
        ...base,
        kind: "sell" as const,
        amount: "percentBps" in size ? { percentBps: size.percentBps } : { base: terms.limitBase },
      };
}

/**
 * Sizes an order's fill when its trigger fires (decision 0195): a buy spends its size of the
 * asset it names, by amount, by share of the spendable balance or in dollars at that asset's USD
 * price; a sale sells its size of the token, never more than the wallet holds, in dollars at the
 * trigger's price first, then at its own quote's when that quote values it higher (decision 0197).
 * A sale of a position that holds none of the token is `empty`; a buy that comes to nothing skips
 * with `nothing_to_spend`, a sale with `nothing_to_sell`, a size in dollars nothing prices with
 * `no_price`, and a balance the read had no entry for with `balance_unread`.
 */
export async function sizeFill(parts: FillSizeParts, sizing: Sizing): Promise<FillSizing> {
  const { order } = sizing;
  const isBuy = order.request.side === "buy";
  const coin = coinOf(parts, order);
  const asset = isBuy ? (order.request.spend ?? coin) : order.request.token;
  const account = await accountOf(parts, sizing);
  const facts = await sizeFacts(parts, sizing, { asset, coin, account });
  if (facts === undefined) {
    return { kind: "skip", reason: "balance_unread" };
  }
  if (!isBuy && facts.heldBase === 0n) {
    return { kind: "empty" };
  }
  const limit = fillLimitBase(order.request.size, facts);
  if (!limit.ok) {
    return { kind: "skip", reason: "no_price" };
  }
  if (limit.value === 0n) {
    return { kind: "skip", reason: isBuy ? "nothing_to_spend" : "nothing_to_sell" };
  }
  const request = requestOf(order, { spend: asset, limitBase: limit.value });
  return { kind: "sized", request, limitBase: limit.value };
}
