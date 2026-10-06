import type { Migration } from "../migration.js";
import { migration as meta } from "./0001_meta.js";

/** The agent database's migrations, oldest first. Released files never change. */
export const agentMigrations: readonly Migration[] = [meta];
