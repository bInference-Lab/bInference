import type { EngineStores } from "../records/engine-stores.js";
import { createMemoryAccessStore } from "./memory-access-store.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryConfigJournal } from "./memory-config-journal.js";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.js";
import { createMemoryInboxStore } from "./memory-inbox-store.js";
import { createMemoryIntentStore } from "./memory-intent-store.js";
import { createMemoryLedgerStore, type MemoryLedgerStore } from "./memory-ledger-store.js";
import { createMemoryTransactionStore } from "./memory-transaction-store.js";
import { createMemoryWalletStore, type MemoryWalletStore } from "./memory-wallet-store.js";

/**
 * Every engine store port, in memory, over one shared ledger that tests can also append to, with
 * wallets a test adds.
 */
export interface MemoryEngineStores extends EngineStores {
  readonly ledger: MemoryLedgerStore;
  readonly wallets: MemoryWalletStore;
}

/**
 * Creates every engine store port in memory, for tests that run the engine without SQLite. The
 * intent store appends its ledger entries to the same ledger the `ledger` port reads. The stores
 * keep every row until they are dropped, so a test makes a fresh set.
 */
export function createMemoryEngineStores(): MemoryEngineStores {
  const ledger = createMemoryLedgerStore();
  return {
    intents: createMemoryIntentStore({ ledger }),
    ledger,
    idempotency: createMemoryIdempotencyStore(),
    inbox: createMemoryInboxStore(),
    access: createMemoryAccessStore(),
    agents: createMemoryAgentStore(),
    configJournal: createMemoryConfigJournal(),
    transactions: createMemoryTransactionStore(),
    wallets: createMemoryWalletStore(),
  };
}
