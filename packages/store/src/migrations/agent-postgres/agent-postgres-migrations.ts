import type { PostgresMigration } from "../postgres-migration.js";
import { migration as meta } from "./0001_meta.js";

/** The agent schema's Postgres migrations, oldest first. Released files never change. */
export const agentPostgresMigrations: readonly PostgresMigration[] = [meta];
