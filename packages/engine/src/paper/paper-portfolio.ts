import type { Amount, AssetRef } from "@binference/chain";
import { BinferenceError, type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { PositionStore, WalletFactsSource } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";

/**
 * The paper portfolio (ARCHITECTURE.md section 10): an agent's paper money, held as its wallets'
 * paper positions, so each paper fill moves it at average cost and it keeps its own P&L, apart
 * from the live positions. A reset starts it again from the starting balances (decision 0069): the
 * agent's first wallet receives them, each valued at its USD price when it arrives, and every
 * other paper position of the agent's wallets empties.
 */
export interface PaperPortfolio {
  /** What a wallet holds of an asset on paper: its paper position's units, 0 without one. */
  balance(
    wallet: Id<"wal">,
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<bigint>;
  /**
   * Starts the agent's paper portfolio again from `balances`, one per asset, or from the starting
   * balances when absent, and answers the agent's wallets, the first one holding the balances. An
   * agent without a wallet is `no_wallet`. A balance with no usable price is `no_price`, and
   * nothing changed then.
   */
  reset(
    reset: { readonly agent: Id<"agt">; readonly balances?: readonly Amount[] },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly Id<"wal">[], "no_wallet" | "no_price">>;
}

/** What the paper portfolio is kept in and starts from. */
export interface PaperPortfolioOptions {
  readonly positions: Positions;
  readonly store: PositionStore;
  readonly wallets: WalletFactsSource;
  readonly clock: Clock;
  /** What a reset starts from when it names no balances: 1 BNB and 500 USDT by default. */
  readonly startingBalances: readonly Amount[];
}

// A reset that loses its race to a paper fill on the wallet reads the positions again.
const resetAttempts = 3;

interface WalletReset {
  readonly walletId: Id<"wal">;
  readonly atMs: number;
  readonly balances: readonly Amount[];
}

async function resetWallet(
  positions: Positions,
  reset: WalletReset,
  call: { readonly signal: AbortSignal; readonly attemptsLeft: number },
): Promise<Result<undefined, "no_price">> {
  const done = await positions.resetPaper(reset, { signal: call.signal });
  if (done.ok) {
    return ok(undefined);
  }
  if (done.error === "no_price") {
    return err("no_price");
  }
  if (call.attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.positions_stale",
      message: `The paper reset of ${reset.walletId} kept losing its position write.`,
      retryable: true,
      details: { wallet: reset.walletId },
    });
  }
  return resetWallet(positions, reset, { ...call, attemptsLeft: call.attemptsLeft - 1 });
}

/** Creates the {@link PaperPortfolio} over the positions and the agent's wallets. */
export function createPaperPortfolio(options: PaperPortfolioOptions): PaperPortfolio {
  return {
    async balance(wallet, asset, { signal }) {
      const held = await options.store.positions({ walletId: wallet, isPaper: true }, { signal });
      return held.find((position) => position.asset === asset)?.quantityBase ?? 0n;
    },
    async reset({ agent, balances }, { signal }) {
      const wallets = await options.wallets.wallets(agent, { signal });
      const [first, ...others] = wallets;
      if (first === undefined) {
        return err("no_wallet");
      }
      const atMs = options.clock.now();
      const call = { signal, attemptsLeft: resetAttempts };
      const starting = { walletId: first, atMs, balances: balances ?? options.startingBalances };
      // The first wallet goes first: a balance with no price stops the reset before any change.
      const opened = await resetWallet(options.positions, starting, call);
      if (!opened.ok) {
        return opened;
      }
      await Promise.all(
        others.map(async (walletId) =>
          resetWallet(options.positions, { walletId, atMs, balances: [] }, call),
        ),
      );
      return ok(wallets);
    },
  };
}
