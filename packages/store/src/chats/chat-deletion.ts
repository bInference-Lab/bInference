import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** Whose chats a deletion removes: every session of each agent, and all its sessions hold. */
export interface ChatDelete {
  readonly agents: readonly Id<"agt">[];
}

/** How many rows a deletion removed, by what they were. */
export interface ChatsDeleted {
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  /** The chat queue's messages, waiting, taken or dropped. */
  readonly messages: number;
  readonly goals: number;
  readonly progressNotes: number;
  readonly helpers: number;
}

/** The most agents one deletion names. */
const maxAgents = 1_000;

/** Parses a fenced deletion: one agent at least, each named once. */
export const chatDeleteSchema: z.ZodType<Fenced<ChatDelete>> = z.strictObject({
  agents: z
    .array(idSchema("agt"))
    .min(1)
    .max(maxAgents)
    .refine((agents) => new Set(agents).size === agents.length, "Name each agent once."),
  fence: fenceSchema,
});

const countSchema = z.int().nonnegative();

/** Parses a deletion's counts. */
export const chatsDeletedSchema: z.ZodType<ChatsDeleted> = z.strictObject({
  sessions: countSchema,
  turns: countSchema,
  events: countSchema,
  messages: countSchema,
  goals: countSchema,
  progressNotes: countSchema,
  helpers: countSchema,
});
