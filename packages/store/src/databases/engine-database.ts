import { accessTasks } from "../access/sqlite-access-store.js";
import { agentTasks } from "../agents/sqlite-agent-store.js";
import { configJournalTasks } from "../audit/config-journal-tasks.js";
import { idempotencyTasks } from "../ingress/idempotency-tasks.js";
import { inboxTasks } from "../ingress/inbox-tasks.js";
import { intentTasks } from "../intents/intent-tasks.js";
import { ledgerTasks } from "../ledger/ledger-tasks.js";
import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { transactionTasks } from "../transactions/sqlite-transaction-store.js";
import { workerUrl, type DatabaseDefinition } from "./database-definition.js";

/** `engine.sqlite`: money, safety, settings and access. `synchronous=FULL`, for money. */
export const engineDatabase: DatabaseDefinition = {
  name: "engine",
  synchronous: "full",
  migrations: engineMigrations,
  tasks: [
    ...intentTasks,
    ...ledgerTasks,
    ...idempotencyTasks,
    ...inboxTasks,
    ...accessTasks,
    ...agentTasks,
    ...configJournalTasks,
    ...transactionTasks,
  ],
};

/** The engine database's worker entry, for `openDatabase`. */
export const engineWorker: URL = workerUrl(import.meta.url, "engine");
