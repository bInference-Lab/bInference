import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { workerUrl, type DatabaseDefinition } from "./database-definition.js";

/** `engine.sqlite`: money, safety, settings and access. `synchronous=FULL`, for money. */
export const engineDatabase: DatabaseDefinition = {
  name: "engine",
  synchronous: "full",
  migrations: engineMigrations,
  tasks: [],
};

/** The engine database's worker entry, for `openDatabase`. */
export const engineWorker: URL = workerUrl(import.meta.url, "engine");
