import type { Id } from "@binference/core";
import type { EngineStores } from "../records/engine-stores.js";
import { createMemoryAccessStore } from "./memory-access-store.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAgentStore, type MemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryAgentTopicStore } from "./memory-agent-topic-store.js";
import { createMemoryAlertStore } from "./memory-alert-store.js";
import { createMemoryAliveStore } from "./memory-alive-store.js";
import { createMemoryBridgeStore } from "./memory-bridge-store.js";
import { createMemoryCardCopyStore } from "./memory-card-copy-store.js";
import { createMemoryConfigJournal } from "./memory-config-journal.js";
import { createMemoryCredentialStore } from "./memory-credential-store.js";
import { createMemoryDailySummaryStore } from "./memory-daily-summary-store.js";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.js";
import { createMemoryIdentityStore } from "./memory-identity-store.js";
import { createMemoryInboxStore } from "./memory-inbox-store.js";
import { createMemoryInstallStore, type MemoryInstallStore } from "./memory-install-store.js";
import { createMemoryIntentStore, type MemoryIntentStore } from "./memory-intent-store.js";
import { createMemoryLaunchStore } from "./memory-launch-store.js";
import { createMemoryLedgerStore, type MemoryLedgerStore } from "./memory-ledger-store.js";
import { createMemoryModelUsageStore } from "./memory-model-usage-store.js";
import { createMemoryNoticeStore } from "./memory-notice-store.js";
import { createMemoryOrderStore, type MemoryOrderStore } from "./memory-order-store.js";
import { createMemoryOwnerStore } from "./memory-owner-store.js";
import { createMemoryQuestionStore } from "./memory-question-store.js";
import { createMemoryScheduleStore } from "./memory-schedule-store.js";
import { createMemoryShellStore } from "./memory-shell-store.js";
import { createMemoryTrackedWalletStore } from "./memory-tracked-wallet-store.js";
import { createMemoryTracking } from "./memory-tracking.js";
import { createMemoryTransactionStore } from "./memory-transaction-store.js";
import { createMemoryUnbondingStore } from "./memory-unbonding-store.js";
import type { MemoryWebhookRuleStore } from "./memory-webhook-rule-store.js";
import { createMemoryWebhookStores } from "./memory-webhook-stores.js";

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
  readonly webhookRules: MemoryWebhookRuleStore;
}

// The stores that write into no other store's rows but the agents', the inbox and the tracking.
function sideStores(parts: {
  readonly agents: MemoryAgentStore;
  readonly agentInbox: ReturnType<typeof createMemoryAgentInboxStore>;
  readonly tracking: ReturnType<typeof createMemoryTracking>;
}) {
  const { agents, agentInbox, tracking } = parts;
  return {
    questions: createMemoryQuestionStore({ agentInbox }),
    idempotency: createMemoryIdempotencyStore(),
    access: createMemoryAccessStore(),
    configJournal: createMemoryConfigJournal(),
    transactions: createMemoryTransactionStore(),
    notices: createMemoryNoticeStore({ agents }),
    owners: createMemoryOwnerStore(),
    cardCopies: createMemoryCardCopyStore(),
    agentTopics: createMemoryAgentTopicStore(),
    modelUsage: createMemoryModelUsageStore({ agents }),
    schedules: createMemoryScheduleStore({ agents, agentInbox }),
    alerts: createMemoryAlertStore({ agents, agentInbox, tracking }),
    trackedWallets: createMemoryTrackedWalletStore(tracking),
    launches: createMemoryLaunchStore(),
    alive: createMemoryAliveStore(),
    dailySummaries: createMemoryDailySummaryStore({ agents }),
    credentials: createMemoryCredentialStore(),
    shell: createMemoryShellStore(),
  };
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
  const tracking = createMemoryTracking();
  // A freeze of the intent store moves orders, and a move into `active` reads a confirmation.
  const orders = createMemoryOrderStore({
    agents,
    install,
    confirmation: (id) => intents.confirmationNow(id),
    hasIntent: (id) => intents.intentNow(id) !== undefined,
    intentNow: (id) => intents.intentNow(id),
    tracking,
  });
  const inbox = createMemoryInboxStore();
  // A rule fill's move writes its alert and rule, and a move into `active` reads a confirmation.
  const confirmation = (id: Id<"int">) => intents.confirmationNow(id);
  const intentsNow = () => intents.intentsNow();
  const webhooks = createMemoryWebhookStores({ agents, install, inbox, confirmation, intentsNow });
  const { webhookRules } = webhooks;
  const intents = createMemoryIntentStore({
    ledger,
    agents,
    install,
    agentInbox,
    orders,
    webhookRules,
  });
  return {
    ...sideStores({ agents, agentInbox, tracking }),
    intents,
    orders,
    agentInbox,
    ledger,
    inbox,
    agents,
    install,
    bridges: createMemoryBridgeStore({ hasIntent: (id) => intents.intentNow(id) !== undefined }),
    unbondings: createMemoryUnbondingStore({
      hasIntent: (id) => intents.intentNow(id) !== undefined,
    }),
    ...webhooks,
    identities: createMemoryIdentityStore(intents),
  };
}
