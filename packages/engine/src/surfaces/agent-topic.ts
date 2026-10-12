import { type Id, idSchema } from "@binference/core";
import { z } from "zod";

/**
 * Where an agent's messages go in the owner's Telegram chat when topics are on (decision 0186):
 * the topic the bot made for the agent in that chat.
 */
export interface AgentTopic {
  readonly agentId: Id<"agt">;
  /** The owner's private chat, whose id is the owner's numeric Telegram id. */
  readonly chatId: number;
  /** The topic's `message_thread_id`. */
  readonly threadId: number;
  readonly createdAtMs: number;
}

/** Parses an agent topic. */
export const agentTopicSchema: z.ZodType<AgentTopic> = z.strictObject({
  agentId: idSchema("agt"),
  chatId: z.int().positive(),
  threadId: z.int().positive(),
  createdAtMs: z.int().nonnegative(),
});

/** Which agent's topic, in which chat. */
export interface AgentTopicKey {
  readonly agentId: Id<"agt">;
  readonly chatId: number;
}

/** Parses an agent topic key. */
export const agentTopicKeySchema: z.ZodType<AgentTopicKey> = z.strictObject({
  agentId: idSchema("agt"),
  chatId: z.int().positive(),
});
