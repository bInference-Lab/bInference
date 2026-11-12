import { err, type Id, ok, replaceNul, type Result } from "@binference/core";
import type { ChatSurface, Empty, ProtocolErrorCode } from "@binference/protocol";
import { type ChatRelayOptions, pushInbox } from "./chat-relay-parts.js";

/** A message the engine writes to the agent in the owner's place: its words and their surface. */
export interface EngineMessage {
  readonly agent: Id<"agt">;
  /** Words the agent reads, in brackets, saying what happened; never a value it must not see. */
  readonly text: string;
  /** The surface the owner answered or asked on, which the message names. */
  readonly surface: ChatSurface;
  /** The words hold outside content, such as a helper's report: the turn they start is marked. */
  readonly outsideContent?: boolean;
  /** The words start the chat's next goal turn (decision 0407). */
  readonly goalTurn?: boolean;
  /**
   * The agent runtime asked for the words, such as a helper's report: dropped while a deletion
   * holds the agent's chats, since the runtime may wait on them as it ends the chat (decision 0415).
   */
  readonly fromRuntime?: boolean;
}

/**
 * Starts the agent's next turn with a message from the engine, as an answer to its credential
 * request or the end of an image job does: stored in the agent inbox and pushed on `inbox`, with
 * U+FFFD in place of each U+0000 in its words, such as a command's last lines (decision 0416).
 * Answers the session and turn it opens, or `protocol.busy` while the inbox is full or a deletion
 * holds the agent's chats for words the runtime asked for, and `agent.not_found` for an agent the
 * inbox does not hold. Other words wait while a deletion holds the agent.
 */
export async function wakeWithMessage(
  options: Pick<
    ChatRelayOptions,
    "agentInbox" | "inboxHold" | "ids" | "clock" | "publish" | "intentView"
  >,
  message: EngineMessage,
  signal: AbortSignal,
): Promise<Result<{ readonly session: Id<"ses">; readonly turn: Id<"trn"> }, ProtocolErrorCode>> {
  if (message.fromRuntime === true && options.inboxHold.isHeld(message.agent)) {
    return err("protocol.busy");
  }
  const { ids, clock } = options;
  const turn = ids.next("trn");
  const stored = await options.agentInbox.add(
    {
      id: ids.next("msg"),
      agentId: message.agent,
      kind: "inbox/message",
      turnId: turn,
      payload: {
        text: replaceNul(message.text),
        surface: message.surface,
        ...(message.outsideContent === true ? { outsideContent: true } : {}),
        ...(message.goalTurn === true ? { goalTurn: true } : {}),
      },
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

/**
 * Wakes the agent with words the agent runtime asked for, such as a helper's report (decisions
 * 0403 and 0415): answers `{}` once they are stored, or once a full inbox or a deletion of the
 * agent's chats dropped them, else the refusal. The engine keeps nothing to send them again.
 */
export async function wakeForRuntime(
  options: Parameters<typeof wakeWithMessage>[0],
  message: Omit<EngineMessage, "fromRuntime">,
  signal: AbortSignal,
): Promise<Result<Empty, ProtocolErrorCode>> {
  const woken = await wakeWithMessage(options, { ...message, fromRuntime: true }, signal);
  return woken.ok || woken.error === "protocol.busy" ? ok({}) : woken;
}
