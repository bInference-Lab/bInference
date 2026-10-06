import { isId } from "@binference/core";
import { z } from "zod";
import { idPrefixes } from "../ids/id-prefixes.js";

const fixedTopics = [
  "engine",
  "intent",
  "order",
  "portfolio",
  "ledger",
  "alert",
  "notice",
  "inbox",
  "config",
  "job",
  "log",
] as const;

const chatPrefix = "chat:";

/** A push topic: a fixed name, or `chat:` and an agent's id for that agent's chat. */
export type PushTopic = (typeof fixedTopics)[number] | `chat:${string}`;

function isChatTopic(text: string): text is `chat:${string}` {
  return text.startsWith(chatPrefix) && isId(idPrefixes.agent, text.slice(chatPrefix.length));
}

/** Parses a push topic. A client receives only the topics its scopes allow. */
export const pushTopicSchema: z.ZodType<PushTopic, string> = z.union([
  z.enum(fixedTopics),
  z
    .string()
    .refine(isChatTopic, { message: "Expected chat: and an agent id." })
    .meta({ pattern: `^${chatPrefix}${idPrefixes.agent}_` }),
]);

/**
 * One event on a topic. `seq` starts at 1 and rises by 1 per topic; a client that sees a gap
 * refetches with the topic's list operation. `kind` names the event, such as `order/filled`, and
 * `data` follows its schema. A kind added inside a version is new to older clients, so clients
 * skip kinds they do not know.
 */
export interface PushFrame {
  readonly t: "push";
  readonly topic: PushTopic;
  readonly seq: number;
  readonly kind: string;
  readonly data: unknown;
}

/** Parses a `push` frame. */
export const pushFrameSchema: z.ZodType<PushFrame> = z.object({
  t: z.literal("push"),
  topic: pushTopicSchema,
  seq: z.int().positive(),
  kind: z.string().regex(/^[a-z][a-zA-Z0-9]*\/[a-z][a-zA-Z0-9]*$/),
  data: z.unknown(),
});
