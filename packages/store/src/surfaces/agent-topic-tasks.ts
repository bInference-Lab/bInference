import { idSchema } from "@binference/core";
import {
  type AgentTopic,
  type AgentTopicKey,
  agentTopicKeySchema,
  agentTopicSchema,
} from "@binference/engine/surfaces";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** The agent's topic in the chat, or null before the bot made one. */
export const findAgentTopicTask: StoreTask<AgentTopicKey, AgentTopic | null> = defineTask({
  name: "telegram.find_agent_topic",
  access: "read",
  input: agentTopicKeySchema,
  output: agentTopicSchema.nullable(),
  run(database, key) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("telegram_topics")
        .selectAll()
        .where("agent_id", "=", key.agentId)
        .where("chat_id", "=", key.chatId),
    );
    return row === undefined
      ? null
      : agentTopicSchema.parse({
          agentId: row.agent_id,
          chatId: row.chat_id,
          threadId: row.thread_id,
          createdAtMs: row.created_at,
        });
  },
});

/** Keeps a topic in place of any earlier one of the agent in that chat. */
export const keepAgentTopicTask: StoreTask<AgentTopic, null> = defineTask({
  name: "telegram.keep_agent_topic",
  access: "write",
  input: agentTopicSchema,
  output: z.null(),
  run(database, topic) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const row = { thread_id: topic.threadId, created_at: topic.createdAtMs };
    execute(
      kysely
        .insertInto("telegram_topics")
        .values({ agent_id: topic.agentId, chat_id: topic.chatId, ...row })
        .onConflict((conflict) => conflict.columns(["agent_id", "chat_id"]).doUpdateSet(row)),
    );
    return null;
  },
});

/** A topic Telegram said is gone: its agent, its chat and its thread. */
type GoneTopic = AgentTopicKey & { readonly threadId: number };

const goneSchema: z.ZodType<GoneTopic> = z.strictObject({
  agentId: idSchema("agt"),
  chatId: z.int().positive(),
  threadId: z.int().positive(),
});

/** Forgets the agent's topic in the chat while it is still the one Telegram said is gone. */
export const forgetAgentTopicTask: StoreTask<GoneTopic, null> = defineTask({
  name: "telegram.forget_agent_topic",
  access: "write",
  input: goneSchema,
  output: z.null(),
  run(database, gone) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .deleteFrom("telegram_topics")
        .where("agent_id", "=", gone.agentId)
        .where("chat_id", "=", gone.chatId)
        .where("thread_id", "=", gone.threadId),
    );
    return null;
  },
});
