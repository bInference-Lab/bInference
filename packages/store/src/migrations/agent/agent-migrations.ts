import type { Migration } from "../migration.js";
import { migration as meta } from "./0001_meta.js";
import { migration as chats } from "./0002_chats.js";
import { migration as notes } from "./0003_notes.js";

/** The agent database's migrations, oldest first. Released files never change. */
export const agentMigrations: readonly Migration[] = [meta, chats, notes];
