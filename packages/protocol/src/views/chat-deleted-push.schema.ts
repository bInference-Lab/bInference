import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/**
 * The push of an agent's chat topic that says its chats were deleted (decision 0415): a surface
 * that shows the chat clears it, and the owner's next message opens a new one.
 */
export interface ChatDeletedPush {
  readonly kind: "chat/deleted";
  readonly agent: ProtocolId<"agent">;
}

const dataSchema = z.object({ agent: protocolIdSchema("agent") });

/** Reads a push of a chat topic as a {@link ChatDeletedPush}; `undefined` for any other push. */
export function chatDeletedPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): ChatDeletedPush | undefined {
  if (push.kind !== "chat/deleted") {
    return undefined;
  }
  const data = dataSchema.safeParse(push.data);
  return data.success ? { kind: push.kind, agent: data.data.agent } : undefined;
}
