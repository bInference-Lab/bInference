import type { PostgresMigration } from "../postgres-migration.js";
import { migration as meta } from "./0001_meta.js";
import { migration as chats } from "./0002_chats.js";
import { migration as notes } from "./0003_notes.js";
import { migration as runtimeChats } from "./0004_runtime_chats.js";
import { migration as chatQueueSeq } from "./0005_chat_queue_seq.js";

/** The agent schema's Postgres migrations, oldest first. Released files never change. */
export const agentPostgresMigrations: readonly PostgresMigration[] = [
  meta,
  chats,
  notes,
  runtimeChats,
  chatQueueSeq,
];
