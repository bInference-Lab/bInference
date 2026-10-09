import type { PriceSource, Signer, TxSimulator } from "@binference/chain";
import { BinferenceError, err } from "@binference/core";
import type { PositionStore, Simulator, WalletFactsSource } from "@binference/engine";
import type { CeilingEditor } from "@binference/engine/install";

/** A part the self-hosted root cannot fill yet; `status` shows each one as a failed signal. */
type MissingPart = "custody" | "prices" | "wallets" | "simulator" | "positions";

/**
 * The parts the self-hosted root has no adapter for yet: custody through the owner's Privy app,
 * Chainlink prices, the wallet facts, the transaction simulator and the stored positions. Each
 * stands in as a missing part that refuses: custody holds no wallet and signs nothing, every asset
 * has no price, no agent has a wallet, no position is stored. No missing part makes up a balance, a price or a signature, so nothing moves
 * money and nothing fills on paper. They hold nothing, so they never pass their ports' contract
 * checks for a known wallet or asset; their own test proves each refusal.
 */
export interface MissingParts {
  readonly custody: Signer;
  readonly ceilings: CeilingEditor;
  readonly prices: PriceSource;
  readonly wallets: WalletFactsSource;
  readonly simulator: Simulator;
  /** The chain's simulator under the risk step's round trip, missing with the simulator. */
  readonly txSimulator: TxSimulator;
  /** Outbound HTTP: every request fails at once, as one that reaches no host. */
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

// The chain's own simulator goes missing with the simulate step, under the same part.
const missingTxSimulator: TxSimulator = {
  async simulate(_drafts, options) {
    options.signal.throwIfAborted();
    return Promise.reject(missing("simulator", "chain.simulation_failed"));
  },
};

// Custody's ceilings change through Privy, which no adapter reaches yet.
async function refuseCustody(options: { readonly signal: AbortSignal }): Promise<never> {
  options.signal.throwIfAborted();
  return Promise.reject(missing("custody", "wallet.custody_down"));
}

const missingCeilings: CeilingEditor = {
  setRecipients: async (_request, options) => refuseCustody(options),
  signRecipients: async (_request, options) => refuseCustody(options),
  sendSigned: async (_change, options) => refuseCustody(options),
};

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
    ceilings: missingCeilings,
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
    txSimulator: missingTxSimulator,
    // Positions have no SQLite adapter yet, and a paper fill must not vanish.
    positions: {
      positions: async (_query, options) => refuse("positions", options),
      record: async (_write, options) => refuse("positions", options),
      executions: async (_query, options) => refuse("positions", options),
      recordArrival: async (_write, options) => refuse("positions", options),
      arrivals: async (_query, options) => refuse("positions", options),
      resetPaper: async (_reset, options) => refuse("positions", options),
    },
    missing: ["custody", "prices", "wallets", "simulator", "positions"],
  };
}
