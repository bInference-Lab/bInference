import { accessTasks } from "../access/sqlite-access-store.js";
import { agentInboxTasks } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { agentTasks } from "../agents/sqlite-agent-store.js";
import { configJournalTasks } from "../audit/config-journal-tasks.js";
import { backupTasks } from "../backups/backup-tasks.js";
import { installGuardsTasks } from "../backups/install-guards-tasks.js";
import { idempotencyTasks } from "../ingress/idempotency-tasks.js";
import { inboxTasks } from "../ingress/inbox-tasks.js";
import { installTasks } from "../install/sqlite-install-store.js";
import { intentTasks } from "../intents/intent-tasks.js";
import { ledgerTasks } from "../ledger/ledger-tasks.js";
import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { modelUsageTasks } from "../model-usage/sqlite-model-usage-store.js";
import { noticeTasks } from "../notices/notice-tasks.js";
import { orderTasks } from "../orders/order-tasks.js";
import { positionTasks } from "../positions/sqlite-position-store.js";
import { riskCacheTasks } from "../risk-cache/risk-cache-tasks.js";
import { agentTopicTasks } from "../surfaces/sqlite-agent-topic-store.js";
import { cardCopyTasks } from "../surfaces/sqlite-card-copy-store.js";
import { ownerTasks } from "../surfaces/sqlite-owner-store.js";
import { transactionTasks } from "../transactions/sqlite-transaction-store.js";
import { workerUrl, type DatabaseDefinition } from "./database-definition.js";

/** `engine.sqlite`: money, safety, settings and access. `synchronous=FULL`, for money. */
export const engineDatabase: DatabaseDefinition = {
  name: "engine",
  synchronous: "full",
  migrations: engineMigrations,
  tasks: [
    ...intentTasks,
    ...orderTasks,
    ...ledgerTasks,
    ...idempotencyTasks,
    ...inboxTasks,
    ...accessTasks,
    ...agentTasks,
    ...agentInboxTasks,
    ...configJournalTasks,
    ...transactionTasks,
    ...installTasks,
    ...riskCacheTasks,
    ...backupTasks,
    ...installGuardsTasks,
    ...positionTasks,
    ...noticeTasks,
    ...ownerTasks,
    ...cardCopyTasks,
    ...agentTopicTasks,
    ...modelUsageTasks,
  ],
};

/** The engine database's worker entry, for `openDatabase`. */
export const engineWorker: URL = workerUrl(import.meta.url, "engine");
