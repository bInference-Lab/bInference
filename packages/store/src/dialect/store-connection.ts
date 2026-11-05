import type { DatabaseSync } from "node:sqlite";

/**
 * The connection a store task runs its queries on, synchronously, inside the task's one
 * transaction: on SQLite, the store worker's `node:sqlite` connection. A task passes it to
 * `createSyncKysely` and to the row helpers it calls, and never uses it any other way.
 */
export type StoreConnection = DatabaseSync;
