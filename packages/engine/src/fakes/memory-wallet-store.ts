import { type WalletRecord, walletListLimit } from "../agents/wallet-record.js";
import type { WalletStore } from "../ports.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** An in-memory {@link WalletStore} that a test fills with wallets. */
export interface MemoryWalletStore extends WalletStore {
  /** Stores a wallet, as setting up an install does; a taken id is refused with `store.constraint`. */
  add(wallet: WalletRecord): void;
}

/** Creates an empty in-memory {@link WalletStore} for tests. */
export function createMemoryWalletStore(): MemoryWalletStore {
  const wallets = new Map<string, WalletRecord>();
  return {
    add(wallet) {
      if (wallets.has(wallet.id)) {
        throw constraintFault(`wallet ${wallet.id} exists`);
      }
      wallets.set(wallet.id, structuredClone(wallet));
    },
    list: async (query, options) =>
      memoryCall(options, () =>
        structuredClone(
          [...wallets.values()]
            .filter((wallet) => query.agentId === undefined || wallet.agentId === query.agentId)
            .toSorted(byCreation)
            .slice(0, walletListLimit),
        ),
      ),
  };
}
