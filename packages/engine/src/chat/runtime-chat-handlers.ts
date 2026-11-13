import { err, type Id, idSchema, ok } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import { heldErrorOf } from "../agents/breaker-hold.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { noticePush } from "../pushes/notice-push.js";
import { isWakeUp } from "./agent-inbox-record.js";
import { type ChatRelayOptions, chatTopic } from "./chat-relay-parts.js";
import { inboxViewOf } from "./inbox-views.js";
import { askOwner } from "./question-flow.js";

/** The agent's side of chat that the engine answers (protocol spec, section 7.7). */
export interface RuntimeChatHandlers {
  readonly "turn/start": EngineHandler<"turn/start">;
  readonly "turn/mark": EngineHandler<"turn/mark">;
  readonly "turn/say": EngineHandler<"turn/say">;
  readonly "turn/status": EngineHandler<"turn/status">;
  readonly "turn/progress": EngineHandler<"turn/progress">;
  readonly "turn/reasoning": EngineHandler<"turn/reasoning">;
  readonly "turn/ask": EngineHandler<"turn/ask">;
  readonly "turn/end": EngineHandler<"turn/end">;
  readonly "usage/record": EngineHandler<"usage/record">;
  readonly "inbox/list": EngineHandler<"inbox/list">;
  readonly "inbox/take": EngineHandler<"inbox/take">;
}

const defaultPageSize = 50;

/** The status line of a turn the loop guard ended, and the owner's notice of it (spec 4). */
const loopStatusKey = "turn.loop";
const loopNoticeKey = "notice.loop";

// The loop guard's status line also tells the owner, through the notice outbox (spec 4, section
// 8.1): the notice names the agent.
async function noticeLoop(
  options: ChatRelayOptions,
  agent: ProtocolId<"agent">,
  signal: AbortSignal,
): Promise<void> {
  const settings = await options.agents.get(agent, { signal });
  const name = settings?.agent.name ?? agent;
  options.publish(noticePush({ key: loopNoticeKey, agent, values: { agent: name } }));
}

// A frozen agent's turn starts for the owner's messages and the settle messages, never for wake-ups
// alone (runtime spec, section 4.4).
async function onlyWakesUp(
  options: ChatRelayOptions,
  messages: readonly ProtocolId<"inboxMessage">[],
  signal: AbortSignal,
): Promise<boolean> {
  const stored = await Promise.all(
    messages.map(async (message) => options.agentInbox.get(message, { signal })),
  );
  // A resume report only joins a turn, so it neither starts one nor counts against a wake-up's.
  const turnMessages = stored.filter((message) => message?.kind !== "inbox/resumeReport");
  return (
    turnMessages.length > 0 &&
    turnMessages.every((message) => message !== undefined && isWakeUp(message.kind))
  );
}

// The agent a turn starts for: refused when it is unknown or archived, and when it is frozen and
// the turn holds wake-ups alone.
async function startable(options: ChatRelayOptions, call: EngineCall<"turn/start">) {
  const active = await activeAgent(options.agents, call.args.agent, call);
  const held = active.ok ? heldErrorOf(active.value.agent) : undefined;
  return held !== undefined && (await onlyWakesUp(options, call.args.messages, call.signal))
    ? err(held)
    : active;
}

// Only the runtime the engine runs now speaks for the agent: every other caller, another client
// with the `agent` scope or a runtime of an earlier start among them, is refused `auth.scope`, so
// no client can start a turn, mark one clean or take the runtime's messages.
function runtimeOnly<N extends keyof RuntimeChatHandlers>(
  options: ChatRelayOptions,
  handler: EngineHandler<N>,
): EngineHandler<N> {
  return async (call) =>
    options.turns.isRuntime(call.caller.credential) ? handler(call) : err("auth.scope");
}

// A plugin's or a listed MCP server's tools are in the turn's context from its start, whatever the
// runtime says (decisions 0350 and 0428).
function offersOutsideTools(options: ChatRelayOptions, agent: Id<"agt">): boolean {
  return options.communityPluginsOn?.() === true || options.listedMcpOn?.(agent) === true;
}

// Starts a turn of an agent that may take one: within its model budget, then its turns of the last
// minute (decision 0431).
async function startTurn(options: ChatRelayOptions, call: EngineCall<"turn/start">) {
  const { agent, session, turn, outsideContent, messages } = call.args;
  const active = await startable(options, call);
  if (!active.ok) {
    return active;
  }
  const left = await options.budget.open(active.value, call);
  await options.quotas?.starting(agent, call);
  const marked = outsideContent || offersOutsideTools(options, agent);
  options.turns.start({ agent, turn, hasOutsideContent: marked, messages });
  options.publish({
    topic: chatTopic(agent),
    kind: "chat/turnStarted",
    data: { agent, session, turn },
  });
  return ok({ budgetLeftMicros: left });
}

function turnHandlers(
  options: ChatRelayOptions,
): Pick<RuntimeChatHandlers, "turn/start" | "turn/mark" | "turn/say" | "turn/status" | "turn/end"> {
  const { turns, publish } = options;
  return {
    "turn/start": async (call) => startTurn(options, call),
    async "turn/mark"(call) {
      const { agent, turn } = call.args;
      return Promise.resolve(turns.mark(agent, turn) ? ok({}) : err("protocol.bad_args"));
    },
    async "turn/say"(call) {
      const { agent, session, turn, text, final } = call.args;
      const data = { agent, session, turn, text, final };
      publish({ topic: chatTopic(agent), kind: "chat/message", data });
      return Promise.resolve(ok({}));
    },
    async "turn/status"(call) {
      const { agent, turn, statusKey, values } = call.args;
      const data = { agent, turn, statusKey, ...(values === undefined ? {} : { values }) };
      publish({ topic: chatTopic(agent), kind: "chat/status", data });
      if (statusKey === loopStatusKey) {
        await noticeLoop(options, agent, call.signal);
      }
      return ok({});
    },
    async "turn/end"(call) {
      const { agent, turn, outcome, failedTool } = call.args;
      turns.end(agent, turn);
      const failed = failedTool === undefined ? {} : { failedTool };
      const data = { agent, turn, outcome, ...failed };
      publish({ topic: chatTopic(agent), kind: "chat/turnEnded", data });
      return Promise.resolve(ok({}));
    },
  };
}

// A line of the turn's work in progress reaches the agent's chat topic and nothing keeps it.
function progressHandler(options: ChatRelayOptions): EngineHandler<"turn/progress"> {
  return async (call) => {
    const { agent, turn, progressKey, values } = call.args;
    const data = { agent, turn, progressKey, ...(values === undefined ? {} : { values }) };
    options.publish({ topic: chatTopic(agent), kind: "chat/progress", data });
    return Promise.resolve(ok({}));
  };
}

// The model's reasoning reaches the agent's chat topic and nothing keeps it (decision 0377).
function reasoningHandler(options: ChatRelayOptions): EngineHandler<"turn/reasoning"> {
  return async (call) => {
    const { agent, turn, text, final } = call.args;
    options.publish({
      topic: chatTopic(agent),
      kind: "chat/reasoning",
      data: { agent, turn, text, final },
    });
    return Promise.resolve(ok({}));
  };
}

// Each model call attempt's usage is taken whatever the agent's state now, since it was spent, and
// charged once by the key the runtime sent it under (decision 0198).
function usageHandler(options: ChatRelayOptions): EngineHandler<"usage/record"> {
  return async (call) => {
    const { key } = call;
    const { agent, turn, ...usage } = call.args;
    const settings = await options.agents.get(agent, call);
    if (settings === undefined) {
      return err("agent.not_found");
    }
    if (key === undefined) {
      return err("protocol.key_required");
    }
    const charge = { ...usage, agent, turn, key, atMs: options.clock.now() };
    const { leftMicros, resumesAt } = await options.budget.charge(settings, charge, call);
    return ok({ budgetLeftMicros: leftMicros, ...(resumesAt === undefined ? {} : { resumesAt }) });
  };
}

function inboxHandlers(
  options: ChatRelayOptions,
): Pick<RuntimeChatHandlers, "inbox/list" | "inbox/take"> {
  return {
    async "inbox/list"(call) {
      const { agent, cursor, limit = defaultPageSize } = call.args;
      // A cursor is the id of the last message of the page before.
      const parsed = cursor === undefined ? undefined : idSchema("msg").safeParse(cursor);
      if (parsed?.success === false) {
        return err("protocol.bad_args");
      }
      const after = parsed?.data;
      const messages = await options.agentInbox.untaken(
        {
          ...(agent === undefined ? {} : { agentId: agent }),
          ...(after === undefined ? {} : { after }),
          limit: limit + 1,
        },
        call,
      );
      const page = messages.slice(0, limit);
      const items = await Promise.all(
        page.map(async (message) => inboxViewOf(message, options.intentView, call.signal)),
      );
      const last = page.at(-1);
      const more = messages.length > limit && last !== undefined;
      return ok({ items, ...(more ? { next: last.id } : {}) });
    },
    async "inbox/take"(call) {
      const taken = { ids: call.args.messages, atMs: options.clock.now() };
      await options.agentInbox.take(taken, call);
      return ok({});
    },
  };
}

/**
 * Creates the agent's side of chat, which only the token of the runtime's current start may call
 * (runtime spec, section 4.3): `turn/start` records the agent's running turn with the mark its
 * context holds, `turn/mark` marks it for good, `turn/say`, `turn/status`, `turn/progress`, `turn/reasoning` and `turn/end` reach the
 * agent's chat topic, the loop guard's status line also sends `notice.loop`, `turn/start` refuses
 * a turn once the agent's model budget of the day is spent, `turn/ask` asks the owner the agent's
 * question, `usage/record` charges each model call attempt once, and `inbox/list` and `inbox/take` hand the runtime its stored messages.
 */
export function createRuntimeChatHandlers(options: ChatRelayOptions): RuntimeChatHandlers {
  const turn = turnHandlers(options);
  const inbox = inboxHandlers(options);
  return {
    "turn/start": runtimeOnly(options, turn["turn/start"]),
    "turn/mark": runtimeOnly(options, turn["turn/mark"]),
    "turn/say": runtimeOnly(options, turn["turn/say"]),
    "turn/status": runtimeOnly(options, turn["turn/status"]),
    "turn/progress": runtimeOnly(options, progressHandler(options)),
    "turn/reasoning": runtimeOnly(options, reasoningHandler(options)),
    "turn/ask": runtimeOnly(options, async (call) => askOwner(options, call)),
    "turn/end": runtimeOnly(options, turn["turn/end"]),
    "usage/record": runtimeOnly(options, usageHandler(options)),
    "inbox/list": runtimeOnly(options, inbox["inbox/list"]),
    "inbox/take": runtimeOnly(options, inbox["inbox/take"]),
  };
}
