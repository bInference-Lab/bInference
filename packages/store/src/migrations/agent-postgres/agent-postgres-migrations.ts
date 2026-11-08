import type { PostgresMigration } from "../postgres-migration.js";
import { migration as meta } from "./0001_meta.js";
import { migration as chats } from "./0002_chats.js";
import { migration as notes } from "./0003_notes.js";
import { migration as runtimeChats } from "./0004_runtime_chats.js";
import { migration as chatQueueSeq } from "./0005_chat_queue_seq.js";
import { migration as helpers } from "./0006_helpers.js";
import { migration as sessionModel } from "./0007_session_model.js";

/** The agent schema's Postgres migrations, oldest first. Released files never change. */
export const agentPostgresMigrations: readonly PostgresMigration[] = [
  meta,
  chats,
  notes,
  runtimeChats,
  chatQueueSeq,
  helpers,
  sessionModel,
];
