import type { ChatDeleteOperationShapes } from "../operations/chat-delete-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** An example call of the chat deletion. */
export const chatDeleteExamples: {
  readonly [N in keyof ChatDeleteOperationShapes]: WireExample;
} = {
  "chat/delete": {
    args: { agent: ids.agent },
    result: {
      agents: [ids.agent],
      sessions: 3,
      turns: 41,
      events: 286,
      messages: 44,
      goals: 1,
      progressNotes: 1,
      helpers: 2,
      inboxMessages: 44,
      questions: 1,
    },
  },
};
