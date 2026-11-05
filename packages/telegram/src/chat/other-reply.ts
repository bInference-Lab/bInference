import type { JsonValue } from "@binference/core";
import { z } from "zod";

/** Where a reply another part of the bot shows belongs: its agent, and its turn when it names one. */
export interface OtherReply {
  readonly agent: string;
  readonly turn?: string;
}

// A question names its turn, a launch draft only its agent.
const otherReplySchema = z.looseObject({
  kind: z.enum(["chat/question", "chat/launchDraft"]),
  data: z.looseObject({ agent: z.string(), turn: z.string().optional() }),
});

/**
 * Reads a push of an agent's chat topic that another part of the bot shows as a reply of a
 * running turn: the agent's question or its launch draft. Any other push gives none.
 */
export function otherReplyOf(push: {
  readonly kind: string;
  readonly data: JsonValue;
}): OtherReply | undefined {
  const reply = otherReplySchema.safeParse(push);
  if (!reply.success) {
    return undefined;
  }
  const { agent, turn } = reply.data.data;
  return turn === undefined ? { agent } : { agent, turn };
}
