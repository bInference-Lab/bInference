import type { PostgresMigration } from "../postgres-migration.js";
import { migration as meta } from "./0001_meta.js";

/** The engine schema's migrations in their Postgres form, oldest first. Released files never change. */
export const enginePostgresMigrations: readonly PostgresMigration[] = [meta];
