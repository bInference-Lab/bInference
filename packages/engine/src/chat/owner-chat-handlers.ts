import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { activeAgent } from "../operations/active-agent.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import type { AgentInboxDraft, AgentInboxMessage } from "./agent-inbox-record.js";
import { type ChatRelayOptions, pushInbox } from "./chat-relay-parts.js";
import { answerQuestion, closeQuestion } from "./question-flow.js";

/** The owner's side of chat (protocol spec, section 7.7). */
export interface OwnerChatHandlers {
  readonly "chat/post": EngineHandler<"chat/post">;
  readonly "chat/stop": EngineHandler<"chat/stop">;
  readonly "chat/clear": EngineHandler<"chat/clear">;
  readonly "chat/answer": EngineHandler<"chat/answer">;
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

// The owner's message while the agent's question is open answers it as typed text, in the write
// that stores the message (protocol spec, section 7.7). A question that closed meanwhile leaves the
// message to go as any other; `undefined` then.
async function answerTyped(
  options: ChatRelayOptions,
  call: EngineCall<"chat/post">,
): Promise<Result<{ session: Id<"ses">; turn: Id<"trn"> }, ProtocolErrorCode> | undefined> {
  const { agent, text, images } = call.args;
  const open = await options.questions.openOf(agent, call);
  if (open === undefined) {
    return undefined;
  }
  const surface = answererOf(call.caller).surface;
  const typed = { typed: text, surface, ...(images === undefined ? {} : { images }) };
  const answered = await answerQuestion(options, open, { answer: typed, signal: call.signal });
  if (!answered.ok) {
    return answered.error === "question.closed" ? undefined : answered;
  }
  const { sessionId, turnId } = answered.value;
  return turnId === undefined ? undefined : ok({ session: sessionId, turn: turnId });
}

// `chat/post`: the owner's message, or the answer to the agent's open question written instead.
function postHandler(options: ChatRelayOptions): EngineHandler<"chat/post"> {
  return async (call) => {
    const { text, images } = call.args;
    const active = await activeAgent(options.agents, call.args.agent, call);
    if (!active.ok) {
      return active;
    }
    const typed = await answerTyped(options, call);
    if (typed !== undefined) {
      if (typed.ok) {
        markIfImages(options, call);
      }
      return typed;
    }
    const turn: Id<"trn"> = options.ids.next("trn");
    const surface = answererOf(call.caller).surface;
    const payload = { text, ...(images === undefined ? {} : { images: [...images] }), surface };
    const stored = await store(options, call, { kind: "inbox/message", turnId: turn, payload });
    if (!stored.ok) {
      return stored;
    }
    markIfImages(options, call);
    return ok({ session: stored.value.sessionId, turn });
  };
}

// `chat/answer`: the owner's choice of the agent's open question.
function answerHandler(options: ChatRelayOptions): EngineHandler<"chat/answer"> {
  return async (call) => {
    const { agent, question, choice } = call.args;
    const active = await activeAgent(options.agents, agent, call);
    if (!active.ok) {
      return active;
    }
    const asked = await options.questions.get(question, call);
    if (asked?.agentId !== agent) {
      return err("question.not_found");
    }
    const answer = { choice, surface: answererOf(call.caller).surface };
    const answered = await answerQuestion(options, asked, { answer, signal: call.signal });
    if (!answered.ok) {
      return answered;
    }
    const { sessionId, turnId } = answered.value;
    return turnId === undefined ? err("question.closed") : ok({ session: sessionId, turn: turnId });
  };
}

/**
 * Creates the owner's chat handlers. Each stores its `inbox` message before it replies, so a
 * message reaches the runtime once even while the runtime is down: `chat/post` an owner's message
 * with the turn the engine reserves for it, which answers the agent's open question as typed text,
 * `chat/stop` a stop, `chat/clear` a clear that names the session that follows and closes the open
 * question, and `chat/answer` the owner's choice of an open question.
 */
export function createOwnerChatHandlers(options: ChatRelayOptions): OwnerChatHandlers {
  return {
    "chat/post": postHandler(options),
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
      if (!stored.ok) {
        return stored;
      }
      const open = await options.questions.openOf(call.args.agent, call);
      if (open !== undefined) {
        await closeQuestion(options, open, { reason: "cleared", signal: call.signal });
      }
      return ok({ session: next });
    },
    "chat/answer": answerHandler(options),
  };
}
