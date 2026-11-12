import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { chatTopic, type ChatRelayOptions } from "./chat-relay-parts.js";
import { closeQuestion } from "./question-flow.js";

/** What a chat deletion removed from `agent.sqlite`, as the runtime answered it (decision 0415). */
export interface RuntimeChatsDeleted {
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  readonly messages: number;
  readonly goals: number;
  readonly progressNotes: number;
  readonly helpers: number;
}

/**
 * The agent runtime's side of a chat deletion (decision 0415), which the composition root routes
 * to the runtime: the engine never writes `agent.sqlite`.
 */
export interface RuntimeChats {
  /** Whether the runtime is up: started, and `ready` since. */
  isUp(): boolean;
  /**
   * Ends each agent's running turn and helpers, waits for them, then deletes their chats in one
   * write; a route that fails answers its code, such as `engine.timeout`.
   */
  delete(
    agents: readonly Id<"agt">[],
    options: { readonly signal: AbortSignal },
  ): Promise<Result<RuntimeChatsDeleted, ProtocolErrorCode>>;
}

const nothingDeleted: RuntimeChatsDeleted = {
  sessions: 0,
  turns: 0,
  events: 0,
  messages: 0,
  goals: 0,
  progressNotes: 0,
  helpers: 0,
};

// The agent the call names, archived or not, or with none every agent not archived.
async function chosenAgents(
  options: ChatRelayOptions,
  call: EngineCall<"chat/delete">,
): Promise<Result<readonly Id<"agt">[], ProtocolErrorCode>> {
  const named = call.args.agent;
  if (named === undefined) {
    const listed = await options.agents.list({ signal: call.signal });
    return ok(listed.filter((each) => each.archivedAtMs === undefined).map((each) => each.id));
  }
  const agent = await options.agents.get(named, call);
  return agent === undefined ? err("agent.not_found") : ok([agent.agent.id]);
}

// Closes each agent's open question, as a clear does; answers how many it closed.
async function closeQuestions(
  options: ChatRelayOptions,
  agents: readonly Id<"agt">[],
  signal: AbortSignal,
): Promise<number> {
  const open = await Promise.all(
    agents.map(async (agent) => options.questions.openOf(agent, { signal })),
  );
  const asked = open.filter((question) => question !== undefined);
  for (const question of asked) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each close edits its copies in turn
    await closeQuestion(options, question, { reason: "cleared", signal });
  }
  return asked.length;
}

// The engine's part, then the runtime's: the agents' shell commands stop, their inbox messages and
// open sessions go, their open questions close, and the runtime deletes their chats.
async function deleteChosen(
  options: ChatRelayOptions,
  runtime: RuntimeChats,
  call: { readonly agents: readonly Id<"agt">[]; readonly signal: AbortSignal },
) {
  const { agents, signal } = call;
  agents.forEach((agent) => options.onStop?.(agent, "owner"));
  const inboxMessages = await options.agentInbox.deleteChats(agents, { signal });
  const questions = await closeQuestions(options, agents, signal);
  const deleted = await runtime.delete(agents, { signal });
  if (!deleted.ok) {
    return deleted;
  }
  for (const agent of agents) {
    options.publish({ topic: chatTopic(agent), kind: "chat/deleted", data: { agent } });
  }
  return ok({ ...deleted.value, inboxMessages, questions });
}

/**
 * `chat/delete` (decision 0415): deletes one agent's chats, or every agent's not archived. While
 * the runtime is down it is `chat.needs_runtime` before anything changes. From then until it
 * answers, the agents' new messages wait, and the wake-ups the runtime asks for are dropped
 * (`InboxHold`). Then the agents' shell
 * commands stop, the agent inbox deletes their messages and lets go their open sessions, their
 * open questions close, the runtime ends their turns and helpers and deletes their chats in one
 * write, and each agent's chat topic hears `chat/deleted`. A route that fails after the engine's
 * part answers its code and pushes nothing; the owner runs it again.
 */
export function createChatDeleteHandler(options: ChatRelayOptions): EngineHandler<"chat/delete"> {
  return async (call) => {
    const chosen = await chosenAgents(options, call);
    if (!chosen.ok) {
      return chosen;
    }
    const runtime = options.runtimeChats;
    if (runtime === undefined || !runtime.isUp()) {
      return err("chat.needs_runtime");
    }
    const agents = chosen.value;
    if (agents.length === 0) {
      return ok({ agents, ...nothingDeleted, inboxMessages: 0, questions: 0 });
    }
    // Every new message of the agents waits until the deletion ended, then lands in the new chat.
    const release = options.inboxHold.hold(agents);
    try {
      const deleted = await deleteChosen(options, runtime, { agents, signal: call.signal });
      return deleted.ok ? ok({ agents, ...deleted.value }) : deleted;
    } finally {
      release();
    }
  };
}
