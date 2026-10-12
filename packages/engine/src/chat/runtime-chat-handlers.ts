import { err, ok } from "@binference/core";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { type ChatRelayOptions, chatTopic } from "./chat-relay-parts.js";
import { inboxCursorOf, parseInboxCursor } from "./inbox-cursor.schema.js";
import { inboxViewOf } from "./inbox-views.js";

/** The agent's side of chat that the engine answers (protocol spec, section 7.7). */
export interface RuntimeChatHandlers {
  readonly "turn/start": EngineHandler<"turn/start">;
  readonly "turn/mark": EngineHandler<"turn/mark">;
  readonly "turn/say": EngineHandler<"turn/say">;
  readonly "turn/status": EngineHandler<"turn/status">;
  readonly "turn/end": EngineHandler<"turn/end">;
  readonly "usage/record": EngineHandler<"usage/record">;
  readonly "inbox/list": EngineHandler<"inbox/list">;
  readonly "inbox/take": EngineHandler<"inbox/take">;
}

const defaultPageSize = 50;

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

function turnHandlers(
  options: ChatRelayOptions,
): Pick<RuntimeChatHandlers, "turn/start" | "turn/mark" | "turn/say" | "turn/status" | "turn/end"> {
  const { turns, publish } = options;
  return {
    async "turn/start"(call) {
      const { agent, session, turn, outsideContent } = call.args;
      const active = await activeAgent(options.agents, agent, call);
      if (!active.ok) {
        return active;
      }
      turns.start({ agent, turn, hasOutsideContent: outsideContent });
      publish({
        topic: chatTopic(agent),
        kind: "chat/turnStarted",
        data: { agent, session, turn },
      });
      return ok({ budgetLeftMicros: active.value.limits.modelBudgetUsdMicros });
    },
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
      return Promise.resolve(ok({}));
    },
    async "turn/end"(call) {
      const { agent, turn, outcome } = call.args;
      turns.end(agent, turn);
      publish({ topic: chatTopic(agent), kind: "chat/turnEnded", data: { agent, turn, outcome } });
      return Promise.resolve(ok({}));
    },
  };
}

// Each model call's usage is taken whatever the agent's state now, since it was spent. The daily
// budget is kept and charged with the model budget's store; until then the answer is the agent's
// daily model budget (decision 0191).
function usageHandler(options: ChatRelayOptions): EngineHandler<"usage/record"> {
  return async (call) => {
    const settings = await options.agents.get(call.args.agent, call);
    return settings === undefined
      ? err("agent.not_found")
      : ok({ budgetLeftMicros: settings.limits.modelBudgetUsdMicros });
  };
}

function inboxHandlers(
  options: ChatRelayOptions,
): Pick<RuntimeChatHandlers, "inbox/list" | "inbox/take"> {
  return {
    async "inbox/list"(call) {
      const { agent, cursor, limit = defaultPageSize } = call.args;
      const after = cursor === undefined ? undefined : parseInboxCursor(cursor);
      if (cursor !== undefined && after === undefined) {
        return err("protocol.bad_args");
      }
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
      return ok({ items, ...(more ? { next: inboxCursorOf(last) } : {}) });
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
 * context holds, `turn/mark` marks it for good, `turn/say`, `turn/status` and `turn/end` reach the
 * agent's chat topic, `usage/record` takes each model call's usage, and `inbox/list` and
 * `inbox/take` hand the runtime its stored messages.
 */
export function createRuntimeChatHandlers(options: ChatRelayOptions): RuntimeChatHandlers {
  const turn = turnHandlers(options);
  const inbox = inboxHandlers(options);
  return {
    "turn/start": runtimeOnly(options, turn["turn/start"]),
    "turn/mark": runtimeOnly(options, turn["turn/mark"]),
    "turn/say": runtimeOnly(options, turn["turn/say"]),
    "turn/status": runtimeOnly(options, turn["turn/status"]),
    "turn/end": runtimeOnly(options, turn["turn/end"]),
    "usage/record": runtimeOnly(options, usageHandler(options)),
    "inbox/list": runtimeOnly(options, inbox["inbox/list"]),
    "inbox/take": runtimeOnly(options, inbox["inbox/take"]),
  };
}
