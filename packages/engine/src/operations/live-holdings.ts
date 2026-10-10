import {
  type Amount,
  accountRefSchema,
  type ChainRegistry,
  type PriceSource,
  type RegisteredChain,
} from "@binference/chain";
import { mulDiv } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";
import type { PositionStore, WalletFactsSource } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import { heldAssetsOf } from "../positions/held-assets.js";
import { isUsablePrice } from "../positions/value-execution.js";
import type { HeldBalance, WalletHoldings } from "./portfolio-view.js";

/** What a live wallet's holdings are read through. */
export interface LiveHoldingsOptions {
  readonly store: PositionStore;
  readonly positions: Positions;
  /** The wallets' balances on the chain, never paper ones. */
  readonly wallets: WalletFactsSource;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
}

interface Read {
  readonly signal: AbortSignal;
}

// Values now round down, so a holding is never overstated.
async function valued(prices: PriceSource, amount: Amount, call: Read): Promise<HeldBalance> {
  const price = await prices.usdPrice(amount.asset, call);
  return price.ok && isUsablePrice(price.value)
    ? { amount, usdMicros: mulDiv(amount.base, price.value, "down") }
    : { amount };
}

async function balancesOn(
  options: LiveHoldingsOptions,
  wallet: WalletRecord,
  call: Read & { readonly chain: RegisteredChain },
): Promise<readonly HeldBalance[]> {
  const account = accountRefSchema.safeParse(`${call.chain.ref}:${wallet.address}`);
  if (!account.success) {
    return [];
  }
  const assets = await heldAssetsOf(options.store, wallet.id, call);
  const held = await options.wallets.balances({ account: account.data, assets }, call);
  const kept = held.filter(({ base }) => base > 0n);
  return Promise.all(kept.map(async (amount) => valued(options.prices, amount, call)));
}

/**
 * A live wallet's holdings now: on each registered chain of its family, what it holds of the
 * chain's coin, of every registry token and of every asset it holds a live position in, read on
 * the chain at its stored address, so a locked engine shows them too, and valued at the price
 * source's price; and its live positions with their value and unrealized P&L. An asset without a
 * price has no value. A chain that cannot be read fails the read, so a portfolio never leaves out
 * a holding without saying so.
 */
export async function liveHoldingsOf(
  options: LiveHoldingsOptions,
  wallet: WalletRecord,
  call: Read,
): Promise<WalletHoldings> {
  const chains = options.chains.list().filter((chain) => chain.definition.family === wallet.family);
  const [balances, positions] = await Promise.all([
    Promise.all(chains.map(async (chain) => balancesOn(options, wallet, { ...call, chain }))),
    options.positions.value({ walletId: wallet.id, isPaper: false }, call),
  ]);
  return { walletId: wallet.id, isPaper: false, balances: balances.flat(), positions };
}
