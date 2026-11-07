import { err, type Id, ok, type Result } from "@binference/core";
import type { ChatSurface, ProtocolErrorCode } from "@binference/protocol";
import { type ChatRelayOptions, pushInbox } from "./chat-relay-parts.js";

/** A message the engine writes to the agent in the owner's place: its words and their surface. */
export interface EngineMessage {
  readonly agent: Id<"agt">;
  /** Words the agent reads, in brackets, saying what happened; never a value it must not see. */
  readonly text: string;
  /** The surface the owner answered or asked on, which the message names. */
  readonly surface: ChatSurface;
}

/**
 * Starts the agent's next turn with a message from the engine, as an answer to its credential
 * request or the end of an image job does: stored in the agent inbox and pushed on `inbox`.
 * Answers the session and turn it opens, or `protocol.busy` while the inbox is full and
 * `agent.not_found` for an agent the inbox does not hold.
 */
export async function wakeWithMessage(
  options: Pick<ChatRelayOptions, "agentInbox" | "ids" | "clock" | "publish" | "intentView">,
  message: EngineMessage,
  signal: AbortSignal,
): Promise<Result<{ readonly session: Id<"ses">; readonly turn: Id<"trn"> }, ProtocolErrorCode>> {
  const { ids, clock } = options;
  const turn = ids.next("trn");
  const stored = await options.agentInbox.add(
    {
      id: ids.next("msg"),
      agentId: message.agent,
      kind: "inbox/message",
      turnId: turn,
      payload: { text: message.text, surface: message.surface },
      atMs: clock.now(),
      opens: ids.next("ses"),
    },
    { signal },
  );
  if (!stored.ok) {
    return err(stored.error === "busy" ? "protocol.busy" : "agent.not_found");
  }
  await pushInbox(options, stored.value, signal);
  return ok({ session: stored.value.sessionId, turn });
}
