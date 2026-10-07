import type { PriceSource, Signer } from "@binference/chain";
import { BinferenceError, err } from "@binference/core";
import type { Executor, PositionStore, Simulator, WalletFactsSource } from "@binference/engine";

/** A part the self-hosted root cannot fill yet; `status` shows each one as a failed signal. */
type MissingPart = "custody" | "prices" | "wallets" | "simulator" | "executor" | "positions";

/**
 * The parts the self-hosted root has no adapter for yet: custody through the owner's Privy app,
 * Chainlink prices, the wallet facts, the transaction simulator, the executor that sends live
 * intents and the stored positions. Each stands in as a missing
 * part that refuses: custody holds no wallet and signs nothing, every asset has no price, no agent
 * has a wallet. No missing part makes up a balance, a price or a signature, so nothing moves money
 * and nothing fills on paper. They hold nothing, so they never pass their ports' contract checks
 * for a known wallet or asset; their own test proves each refusal.
 */
export interface MissingParts {
  readonly custody: Signer;
  readonly prices: PriceSource;
  readonly wallets: WalletFactsSource;
  readonly simulator: Simulator;
  readonly executor: Executor;
  readonly positions: PositionStore;
  /** Every part above that is missing, for the health signals. */
  readonly missing: readonly MissingPart[];
}

function missing(
  part: MissingPart,
  code: "wallet.custody_down" | "chain.simulation_failed" | "internal.error",
): BinferenceError {
  return new BinferenceError({
    code,
    message: `This binference has no ${part} adapter yet, so it refuses the action.`,
    details: { missing: part },
  });
}

async function refuse(
  part: MissingPart,
  options: { readonly signal: AbortSignal },
): Promise<never> {
  options.signal.throwIfAborted();
  return Promise.reject(missing(part, "internal.error"));
}

// Live sending and stored positions: neither has an adapter yet.
function missingMoneyParts(): Pick<MissingParts, "executor" | "positions"> {
  return {
    executor: {
      async take(_intent, options) {
        options.signal.throwIfAborted();
        return Promise.reject(missing("executor", "wallet.custody_down"));
      },
    },
    // Positions have no SQLite adapter yet, and a paper fill must not vanish.
    positions: {
      positions: async (_query, options) => refuse("positions", options),
      record: async (_write, options) => refuse("positions", options),
      executions: async (_query, options) => refuse("positions", options),
      recordArrival: async (_write, options) => refuse("positions", options),
      arrivals: async (_query, options) => refuse("positions", options),
      resetPaper: async (_reset, options) => refuse("positions", options),
    },
  };
}

/** The missing parts, for a self-hosted engine that serves the protocol and refuses to trade. */
export function createMissingParts(): MissingParts {
  return {
    custody: {
      async account(_wallet, _chain, options) {
        options.signal.throwIfAborted();
        return Promise.resolve(err("unknown_wallet"));
      },
      async signTransaction(_request, options) {
        options.signal.throwIfAborted();
        return Promise.resolve(err("refused"));
      },
    },
    prices: {
      async usdPrice(_asset, options) {
        options.signal.throwIfAborted();
        return Promise.resolve(err("no_price"));
      },
    },
    wallets: {
      async wallets(_agent, options) {
        options.signal.throwIfAborted();
        return Promise.resolve([]);
      },
      async facts(_query, options) {
        options.signal.throwIfAborted();
        return Promise.reject(missing("wallets", "wallet.custody_down"));
      },
    },
    simulator: {
      async simulate(_intent, _built, options) {
        options.signal.throwIfAborted();
        return Promise.reject(missing("simulator", "chain.simulation_failed"));
      },
    },
    ...missingMoneyParts(),
    missing: ["custody", "prices", "wallets", "simulator", "executor", "positions"],
  };
}
