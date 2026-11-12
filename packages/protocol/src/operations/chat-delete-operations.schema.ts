import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type OperationTable, writeFlags } from "./operation.schema.js";

/** The args of `chat/delete`: one agent, or with none every agent not archived. */
interface ChatDeleteArgs {
  readonly agent?: ProtocolId<"agent">;
}

/**
 * What `chat/delete` removed (decision 0415): from the agent database, the sessions with their
 * turns, transcript events, queued messages, goals, progress notes and helpers; from the engine's,
 * the messages for the runtime and the open questions it closed.
 */
interface ChatDeleteResult {
  /** The agents whose chats went. */
  readonly agents: readonly ProtocolId<"agent">[];
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  /** The chat queue's messages. */
  readonly messages: number;
  readonly goals: number;
  readonly progressNotes: number;
  readonly helpers: number;
  /** The agent inbox's messages, taken or not. */
  readonly inboxMessages: number;
  /** The open questions closed. */
  readonly questions: number;
}

/**
 * The chat deletion of protocol spec section 7.7: the engine answers it, and routes the part the
 * agent database holds to the runtime.
 */
export interface ChatDeleteOperationShapes {
  readonly "chat/delete": { readonly args: ChatDeleteArgs; readonly result: ChatDeleteResult };
}

const count = z.int().nonnegative();

/** The chat deletion, by name. */
export const chatDeleteOperations: OperationTable<ChatDeleteOperationShapes> = {
  "chat/delete": {
    ...writeFlags,
    name: "chat/delete",
    scope: "admin",
    args: z.strictObject({ agent: protocolIdSchema("agent").exactOptional() }),
    result: z.object({
      agents: z.array(protocolIdSchema("agent")),
      sessions: count,
      turns: count,
      events: count,
      messages: count,
      goals: count,
      progressNotes: count,
      helpers: count,
      inboxMessages: count,
      questions: count,
    }),
  },
};
