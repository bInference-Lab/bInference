// The engine database with the tasks store tests plant rows through, for the Postgres test
// stores' task thread. Nothing in production uses this file.
import { type DatabaseDefinition, workerUrl } from "../databases/database-definition.js";
import { engineDatabase } from "../databases/engine-database.js";
import { readInsidersFieldTask, setInsidersTextTask } from "./old-json-text.js";
import { plantAgentTask, plantWalletTask } from "./plant-agent.js";
import { archiveAgentTask, plantCardsTask, plantWebhookRuleTask } from "./plant-rows.js";
import { setTransactionStateTask } from "./set-transaction-state.js";

/** The engine database's definition, plus the planting tasks of the store tests. */
export const testEngineDatabase: DatabaseDefinition = {
  ...engineDatabase,
  tasks: [
    ...engineDatabase.tasks,
    plantAgentTask,
    plantWalletTask,
    setTransactionStateTask,
    archiveAgentTask,
    plantWebhookRuleTask,
    plantCardsTask,
    setInsidersTextTask,
    readInsidersFieldTask,
  ],
};

/** The worker entry that serves {@link testEngineDatabase}. */
export const testEngineWorker: URL = workerUrl(import.meta.url, "test-engine");
