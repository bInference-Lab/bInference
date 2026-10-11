import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { activeAgent } from "../operations/active-agent.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import type { AgentInboxDraft, AgentInboxMessage } from "./agent-inbox-record.js";
import { type ChatRelayOptions, pushInbox } from "./chat-relay-parts.js";

/** The owner's side of chat (protocol spec, section 7.7). */
export interface OwnerChatHandlers {
  readonly "chat/post": EngineHandler<"chat/post">;
  readonly "chat/stop": EngineHandler<"chat/stop">;
  readonly "chat/clear": EngineHandler<"chat/clear">;
}

type Draft = Omit<AgentInboxDraft, "id" | "agentId" | "atMs" | "opens">;

// Stores a message for an active agent before the call replies, then pushes it on `inbox`.
async function store(
  options: ChatRelayOptions,
  call: EngineCall<"chat/post" | "chat/stop" | "chat/clear">,
  draft: Draft,
): Promise<Result<AgentInboxMessage, ProtocolErrorCode>> {
  const { agent } = call.args;
  const active = await activeAgent(options.agents, agent, call);
  if (!active.ok) {
    return active;
  }
  const { ids, clock } = options;
  const stored = await options.agentInbox.add(
    { ...draft, id: ids.next("msg"), agentId: agent, atMs: clock.now(), opens: ids.next("ses") },
    call,
  );
  if (!stored.ok) {
    return err(stored.error === "busy" ? "protocol.busy" : "agent.not_found");
  }
  await pushInbox(options, stored.value, call.signal);
  return stored;
}

// A message with images may join the running turn, so the turn holds outside content from now on.
function markIfImages(options: ChatRelayOptions, call: EngineCall<"chat/post">): void {
  const { agent, images } = call.args;
  const running = options.turns.runningOf(agent);
  if (images !== undefined && running !== undefined) {
    options.turns.mark(agent, running.turn);
  }
}

/**
 * Creates the owner's chat handlers. Each stores its `inbox` message before it replies, so a
 * message reaches the runtime once even while the runtime is down: `chat/post` an owner's message
 * with the turn the engine reserves for it, `chat/stop` a stop, and `chat/clear` a clear that
 * names the session that follows.
 */
export function createOwnerChatHandlers(options: ChatRelayOptions): OwnerChatHandlers {
  return {
    async "chat/post"(call) {
      const { text, images } = call.args;
      const turn: Id<"trn"> = options.ids.next("trn");
      const surface = answererOf(call.caller).surface;
      const payload = { text, ...(images === undefined ? {} : { images: [...images] }), surface };
      const stored = await store(options, call, { kind: "inbox/message", turnId: turn, payload });
      if (!stored.ok) {
        return stored;
      }
      markIfImages(options, call);
      return ok({ session: stored.value.sessionId, turn });
    },
    async "chat/stop"(call) {
      const stored = await store(options, call, {
        kind: "inbox/stop",
        payload: { reason: "owner" },
      });
      return stored.ok ? ok({}) : stored;
    },
    async "chat/clear"(call) {
      const next = options.ids.next("ses");
      const stored = await store(options, call, { kind: "inbox/clear", payload: { next }, next });
      return stored.ok ? ok({ session: next }) : stored;
    },
  };
}
