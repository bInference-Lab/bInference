import type { EngineStores } from "@binference/engine";
import { createSqliteAccessStore } from "../access/sqlite-access-store.js";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { createSqliteQuestionStore } from "../agent-inbox/sqlite-question-store.js";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { createSqliteAlertStore } from "../alerts/sqlite-alert-store.js";
import { createSqliteConfigJournal } from "../audit/sqlite-config-journal.js";
import { createSqliteIdempotencyStore } from "../ingress/sqlite-idempotency-store.js";
import { createSqliteInboxStore } from "../ingress/sqlite-inbox-store.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { createSqliteModelUsageStore } from "../model-usage/sqlite-model-usage-store.js";
import { createSqliteNoticeStore } from "../notices/sqlite-notice-store.js";
import { createSqliteOrderStore } from "../orders/sqlite-order-store.js";
import { createSqliteScheduleStore } from "../schedules/sqlite-schedule-store.js";
import { createSqliteAgentTopicStore } from "../surfaces/sqlite-agent-topic-store.js";
import { createSqliteCardCopyStore } from "../surfaces/sqlite-card-copy-store.js";
import { createSqliteOwnerStore } from "../surfaces/sqlite-owner-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import { createSqliteTransactionStore } from "../transactions/sqlite-transaction-store.js";

/**
 * Every engine store port on `engine.sqlite`, for the composition root: pass the handle that
 * `openDatabase` returned for the engine database, after `migrate`.
 */
export function createSqliteEngineStores(host: StoreHost): EngineStores {
  return {
    intents: createSqliteIntentStore(host),
    orders: createSqliteOrderStore(host),
    ledger: createSqliteLedgerStore(host),
    idempotency: createSqliteIdempotencyStore(host),
    inbox: createSqliteInboxStore(host),
    access: createSqliteAccessStore(host),
    agents: createSqliteAgentStore(host),
    configJournal: createSqliteConfigJournal(host),
    transactions: createSqliteTransactionStore(host),
    install: createSqliteInstallStore(host),
    notices: createSqliteNoticeStore(host),
    agentInbox: createSqliteAgentInboxStore(host),
    questions: createSqliteQuestionStore(host),
    owners: createSqliteOwnerStore(host),
    cardCopies: createSqliteCardCopyStore(host),
    agentTopics: createSqliteAgentTopicStore(host),
    modelUsage: createSqliteModelUsageStore(host),
    schedules: createSqliteScheduleStore(host),
    alerts: createSqliteAlertStore(host),
  };
}
