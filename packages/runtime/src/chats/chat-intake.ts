import type { Id } from "@binference/core";
import { type InboxMessageView, inboxMessageViewSchema } from "@binference/protocol";
import type { QueuedMessage } from "@binference/store";
import { written } from "../sessions/agent-stores.js";
import type { ChatContext } from "./chat-context.js";
import { payloadOf, startsTurns, turnMessageOf } from "./queued-view.js";
import { closeSession, dropMessages, kickAgent, kickAll } from "./turn-starts.js";

/** The most messages the chat queue holds waiting for one agent (runtime spec, section 3.4). */
const maxWaiting = 200;

type Control = Extract<InboxMessageView, { readonly kind: "inbox/stop" | "inbox/clear" }>;

// Opens the session a message names, the first time the runtime sees it (decision 0174).
async function openSession(context: ChatContext, view: InboxMessageView): Promise<void> {
  const surface = view.kind === "inbox/message" ? view.surface : "engine";
  const { sessions, fence } = context.stores;
  const draft = { id: view.session, agentId: view.agent, surface, conversation: surface };
  const opened = await sessions.open(
    { ...draft, startedAtMs: context.clock.now(), fence },
    { signal: context.lifetime },
  );
  if (!opened.ok && opened.error !== "exists") {
    written(opened, "open a session");
  }
}

async function waitingIn(
  context: ChatContext,
  session: Id<"ses">,
): Promise<readonly QueuedMessage[]> {
  return context.stores.queue.waiting(
    { sessionId: session, limit: maxWaiting },
    { signal: context.lifetime },
  );
}

// Ends the agent's running turn and drops the turn messages that waited before the stop or clear.
async function endWaiting(context: ChatContext, view: Control): Promise<void> {
  const reason = view.kind === "inbox/stop" ? view.reason : "clear";
  context.chats.running.get(view.agent)?.turn.stop(reason);
  context.chats.resumesAt.delete(view.agent);
  const waiting = await waitingIn(context, view.session);
  const ended = waiting.filter(
    (message) => message.message !== view.message && startsTurns(message.kind),
  );
  const dropReason = view.kind === "inbox/stop" ? "stopped" : "cleared";
  await dropMessages(
    context,
    ended.map((message) => message.message),
    dropReason,
  );
}

/**
 * Applies a stop or a clear (runtime spec, section 3.3; decision 0174): the running turn ends and
 * the messages that waited are dropped; a clear also closes its session, once the turn has ended,
 * and the next message opens the session it names.
 */
async function applyControl(context: ChatContext, view: Control): Promise<void> {
  await endWaiting(context, view);
  if (view.kind === "inbox/clear") {
    const { chats } = context;
    if (chats.running.has(view.agent)) {
      chats.closing.set(view.agent, view.session);
    } else {
      await closeSession(context, view.session);
    }
    chats.sessions.set(view.agent, view.next);
  }
  await dropMessages(context, [view.message], "applied");
}

// Writes the message into the chat queue once; answers whether it waits there now.
async function queued(context: ChatContext, view: InboxMessageView): Promise<boolean> {
  const { queue, fence } = context.stores;
  const draft = {
    message: view.message,
    agentId: view.agent,
    sessionId: view.session,
    kind: view.kind,
  };
  const added = await queue.add(
    { ...draft, payload: payloadOf(view), receivedAtMs: context.clock.now(), fence },
    { signal: context.lifetime },
  );
  if (added.ok) {
    return true;
  }
  if (added.error === "fenced") {
    written(added, "queue");
  }
  return (await waitingIn(context, view.session)).some(
    (message) => message.message === view.message,
  );
}

async function receiveOne(context: ChatContext, view: InboxMessageView): Promise<void> {
  const turnMessage = startsTurns(view.kind);
  // A resume report starts no turn, but waits in its session for the next one.
  if (turnMessage || view.kind === "inbox/resumeReport") {
    await openSession(context, view);
  }
  if (turnMessage && (await waitingIn(context, view.session)).length >= maxWaiting) {
    context.chats.full.add(view.agent);
    return;
  }
  const waits = await queued(context, view);
  if (waits && (view.kind === "inbox/stop" || view.kind === "inbox/clear")) {
    await applyControl(context, view);
  }
  await context.engine.takeInbox([view.message], context.lifetime);
  if (waits && turnMessage) {
    context.chats.sessions.set(view.agent, view.session);
    context.chats.resumesAt.delete(view.agent);
    kickAgent(context, view.agent);
  }
}

/**
 * Takes one message of the engine's inbox (runtime spec, section 3.2): it is written into the chat
 * queue, a message already there is not written again, a stop or clear is applied, then the engine
 * hears it was taken, and a turn message wakes its agent's chat. While 200 of an agent's messages
 * wait, a new one stays in the engine's inbox until a turn takes some.
 */
export async function receiveMessage(context: ChatContext, view: InboxMessageView): Promise<void> {
  return context.serial(async () => receiveOne(context, view));
}

function controlOf(message: QueuedMessage): Control | undefined {
  const parsed = inboxMessageViewSchema.safeParse(message.payload);
  const view = parsed.success ? parsed.data : undefined;
  return view?.kind === "inbox/stop" || view?.kind === "inbox/clear" ? view : undefined;
}

/**
 * Picks up what a start found in the chat queue (runtime spec, section 2.4): a stop or clear
 * written but not applied is applied now, and each agent's waiting messages start its next turn.
 */
export async function resumeWaiting(context: ChatContext): Promise<void> {
  await context.serial(async () => {
    const waiting = await context.stores.queue.waiting(
      { limit: 1_000 },
      { signal: context.lifetime },
    );
    for (const message of waiting) {
      const control = controlOf(message);
      if (control !== undefined) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- applied in the order they came
        await applyControl(context, control);
      } else if (turnMessageOf(message) !== undefined) {
        context.chats.sessions.set(message.agentId, message.sessionId);
      }
    }
  });
  kickAll(context);
}
