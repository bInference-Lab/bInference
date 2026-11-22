import type { JsonValue } from "@binference/core";
import { z } from "zod";
import type { Parts } from "./chat-replies-parts.js";

/** Where a reply another part of the bot shows belongs: its agent, and its turn when it names one. */
interface OtherReply {
  readonly agent: string;
  readonly turn?: string;
}

// A question names its turn, a launch draft and a shell request only their agent.
const otherReplySchema = z.looseObject({
  kind: z.enum([
    "chat/question",
    "chat/launchDraft",
    "chat/credentialRequest",
    "chat/shellRequest",
  ]),
  data: z.looseObject({ agent: z.string(), turn: z.string().optional() }),
});

/**
 * Reads a push of an agent's chat topic that another part of the bot shows as a reply of a
 * running turn: the agent's question, its launch draft, its request for a credential or its shell
 * request (decision 0409). Any other push gives none.
 */
function otherReplyOf(push: {
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

/**
 * Notes an agent's question, launch draft, credential request or shell request as a reply of its
 * running turn, which another part of the bot shows.
 */
export function noteOtherReply(
  parts: Pick<Parts, "turns">,
  push: { readonly kind: string; readonly data: JsonValue },
): void {
  const reply = otherReplyOf(push);
  for (const [key, showing] of reply === undefined ? [] : parts.turns) {
    const { agent, turn } = reply ?? { agent: "" };
    if (showing.agent === agent && (turn === undefined || key === `${agent} ${turn}`)) {
      showing.reply.isGiven = true;
    }
  }
}
