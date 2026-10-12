import type { EngineStores } from "../records/engine-stores.js";
import { createMemoryAccessStore } from "./memory-access-store.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAgentStore, type MemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryAgentTopicStore } from "./memory-agent-topic-store.js";
import { createMemoryCardCopyStore } from "./memory-card-copy-store.js";
import { createMemoryConfigJournal } from "./memory-config-journal.js";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.js";
import { createMemoryInboxStore } from "./memory-inbox-store.js";
import { createMemoryInstallStore, type MemoryInstallStore } from "./memory-install-store.js";
import { createMemoryIntentStore, type MemoryIntentStore } from "./memory-intent-store.js";
import { createMemoryLedgerStore, type MemoryLedgerStore } from "./memory-ledger-store.js";
import { createMemoryModelUsageStore } from "./memory-model-usage-store.js";
import { createMemoryNoticeStore } from "./memory-notice-store.js";
import { createMemoryOrderStore, type MemoryOrderStore } from "./memory-order-store.js";
import { createMemoryOwnerStore } from "./memory-owner-store.js";
import { createMemoryTransactionStore } from "./memory-transaction-store.js";

/**
 * Every engine store port, in memory, over one shared ledger that tests can also append to, with
 * an install that takes wallets a test adds.
 */
export interface MemoryEngineStores extends EngineStores {
  readonly ledger: MemoryLedgerStore;
  readonly agents: MemoryAgentStore;
  readonly install: MemoryInstallStore;
  readonly intents: MemoryIntentStore;
  readonly orders: MemoryOrderStore;
}

/**
 * Creates every engine store port in memory, for tests that run the engine without SQLite. The
 * intent store appends its ledger entries to the same ledger the `ledger` port reads. The stores
 * keep every row until they are dropped, so a test makes a fresh set.
 */
export function createMemoryEngineStores(): MemoryEngineStores {
  const ledger = createMemoryLedgerStore();
  const install = createMemoryInstallStore();
  const agents = createMemoryAgentStore({ install });
  const agentInbox = createMemoryAgentInboxStore({ agents });
  // A freeze of the intent store moves orders, and a move into `active` reads a confirmation.
  const orders = createMemoryOrderStore({
    agents,
    install,
    confirmation: (id) => intents.confirmationNow(id),
    hasIntent: (id) => intents.intentNow(id) !== undefined,
  });
  const intents = createMemoryIntentStore({ ledger, agents, install, agentInbox, orders });
  return {
    intents,
    orders,
    agentInbox,
    ledger,
    idempotency: createMemoryIdempotencyStore(),
    inbox: createMemoryInboxStore(),
    access: createMemoryAccessStore(),
    agents,
    configJournal: createMemoryConfigJournal(),
    transactions: createMemoryTransactionStore(),
    install,
    notices: createMemoryNoticeStore({ agents }),
    owners: createMemoryOwnerStore(),
    cardCopies: createMemoryCardCopyStore(),
    agentTopics: createMemoryAgentTopicStore(),
    modelUsage: createMemoryModelUsageStore({ agents }),
  };
}
