import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { maxReasoningChars } from "../views/chat-push.schema.js";
import { readFlags, type OperationTable } from "./operation.schema.js";

/**
 * The args of `turn/reasoning` (protocol spec, section 7.7): the reasoning of the turn's current
 * model call so far, or with `final` the whole reasoning of a call that ended. A surface may show
 * it while the turn runs, or keep it in the chat; the engine keeps none of it.
 */
interface ReasoningArgs {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly text: string;
  readonly final: boolean;
}

/** The operation the agent runtime sends its model's reasoning with (decision 0377). */
export interface ReasoningOperationShapes {
  readonly "turn/reasoning": { readonly args: ReasoningArgs; readonly result: Empty };
}

/** The reasoning operation, by name. */
export const reasoningOperations: OperationTable<ReasoningOperationShapes> = {
  "turn/reasoning": {
    ...readFlags,
    name: "turn/reasoning",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      turn: protocolIdSchema("chatTurn"),
      text: z.string().max(maxReasoningChars),
      final: z.boolean(),
    }),
    result: emptyResultSchema,
  },
};
