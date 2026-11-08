import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "../views/inbox-message-view.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

// The most characters of the words a helper's end tells the agent (decision 0403).
const maxHelperEndChars = 8_000;

/**
 * The args of `helper/ended`: a helper of the agent ended, or several did, and the words the agent
 * reads of it, which start its next turn (decision 0403).
 */
interface HelperEndedArgs {
  readonly agent: ProtocolId<"agent">;
  /** The helper's own session, or the first of those the words name. */
  readonly helper: ProtocolId<"chatSession">;
  /** The surface the agent's turn that started it ran for, which the wake-up names. */
  readonly surface: ChatSurface;
  /** What the agent reads, in brackets: how the helper ended and what it reported. */
  readonly text: string;
  /** A run of the helper read outside content: the turn the words start is marked. */
  readonly outsideContent: boolean;
}

/** The operation the agent runtime tells the agent a helper's end with (decision 0403). */
export interface HelperOperationShapes {
  readonly "helper/ended": { readonly args: HelperEndedArgs; readonly result: Empty };
}

/** The helper operation, by name. */
export const helperOperations: OperationTable<HelperOperationShapes> = {
  "helper/ended": {
    ...readFlags,
    name: "helper/ended",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      helper: protocolIdSchema("chatSession"),
      surface: chatSurfaceSchema,
      text: z.string().trim().min(1).max(maxHelperEndChars),
      outsideContent: z.boolean(),
    }),
    result: emptyResultSchema,
  },
};
