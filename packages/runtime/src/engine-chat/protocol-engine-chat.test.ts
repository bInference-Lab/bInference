import type { TopicHandlers } from "@binference/client";
import { BinferenceError } from "@binference/core";
import {
  type InboxMessageView,
  inboxMessageViewSchema,
  type PushFrame,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { engineChatContract } from "../contracts/engine-chat-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "../testing/memory-engine-chat.js";
import { type ChatClient, createProtocolEngineChat } from "./protocol-engine-chat.js";

const agent = nthTestId("agt", 1);

// A protocol client over the fake engine: each operation the runtime calls, answered as the
// engine answers it on the wire, a refusal as a `fail` with its code.
function clientOver(engine: MemoryEngineChat, topics: Map<string, TopicHandlers>): ChatClient {
  const answer = async (op: string, args: Record<string, unknown>, signal: AbortSignal) => {
    switch (op) {
      case "inbox/list": {
        const page = await engine.listInbox(args["cursor"] as string | undefined, signal);
        return {
          items: page.items.map((view) => inboxMessageViewSchema.parse(view)),
          ...(page.next === undefined ? {} : { next: page.next }),
        };
      }
      case "inbox/take":
        return engine.takeInbox(args["messages"] as never, signal).then(() => ({}));
      case "turn/start": {
        const started = await engine.startTurn(args as never, signal);
        if (!started.started) {
          const { refusal } = started;
          const code = refusal === "quota" ? "quota.turns" : (`agent.${refusal}` as const);
          const details = refusal === "budget" || refusal === "quota" ? { resumesAt: 5 } : {};
          throw new BinferenceError({ code, message: "refused", details });
        }
        return { budgetLeftMicros: started.budgetLeftMicros };
      }
      default:
        return answerTurn(op, args, signal);
    }
  };
  const answerTurn = async (op: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const calls: Readonly<Record<string, (args: never, signal: AbortSignal) => Promise<void>>> = {
      "turn/mark": async (given, at) => engine.markTurn(given, at),
      "turn/say": async (given, at) => engine.sayTurn(given, at),
      "turn/status": async (given, at) => engine.turnStatus(given, at),
      "turn/progress": async (given, at) => engine.turnProgress(given, at),
      "turn/reasoning": async (given, at) => engine.turnReasoning(given, at),
    };
    const call = calls[op] ?? (async (given: never, at: AbortSignal) => engine.endTurn(given, at));
    return call(args as never, signal).then(() => ({}));
  };
  return {
    call: async (
      op: string,
      args: Record<string, unknown>,
      options: { signal: AbortSignal; key?: string },
    ) =>
      op === "usage/record"
        ? engine.recordUsage({ ...args, key: options.key } as never, options.signal)
        : answer(op, args, options.signal),
    subscribe(topic, handlers) {
      topics.set(topic, handlers);
      return () => topics.delete(topic);
    },
  };
}

function pushOf(view: InboxMessageView | { readonly kind: string }, seq: number): PushFrame {
  return {
    t: "push",
    topic: "inbox",
    seq,
    kind: view.kind,
    data: JSON.parse(JSON.stringify(view)),
  };
}

// A client whose engine refuses every turn with the breaker's code, as a held install does.
function heldOnTurnStart(base: ReturnType<typeof clientOver>): ReturnType<typeof clientOver> {
  const held = new BinferenceError({ code: "safety.breaker", message: "refused" });
  return {
    ...base,
    call: async (op, args, options) =>
      op === "turn/start" ? Promise.reject(held) : base.call(op, args, options),
  };
}

describe("createProtocolEngineChat", () => {
  it.each(
    engineChatContract({
      create: async () => {
        const engine = createMemoryEngineChat([agent]);
        const topics = new Map<string, TopicHandlers>();
        const chat = createProtocolEngineChat(clientOver(engine, topics));
        const watching = createProtocolEngineChat({
          ...clientOver(engine, topics),
          subscribe: (topic, handlers) =>
            engine.watchInbox({
              onMessage: (view) => handlers.onPush(pushOf(view, 1)),
              refetch: handlers.refetch,
            }),
        });
        return {
          chat: { ...chat, watchInbox: (watch) => watching.watchInbox(watch) },
          agent,
          unknownAgent: nthTestId("agt", 9),
          post: async (text) => engine.post(agent, text),
          stop: async () => {
            engine.stop(agent);
          },
          clear: async () => engine.clear(agent),
          chatSeen: async () => engine.pushes.map((push) => push.kind),
          feedSeen: async () => engine.feed.map((push) => `${push.kind} ${push.detail}`),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers a spent budget with the time it resumes", async () => {
    const engine = createMemoryEngineChat([agent]);
    engine.refuse(agent, { started: false, refusal: "budget" });
    const chat = createProtocolEngineChat(clientOver(engine, new Map()));
    const posted = engine.post(agent, "hi");
    const start = {
      agent,
      session: posted.session,
      turn: posted.turn,
      messages: [posted.message],
      outsideContent: false,
    };
    await expect(chat.startTurn(start, new AbortController().signal)).resolves.toStrictEqual({
      started: false,
      refusal: "budget",
      resumesAt: 5,
    });
  });

  it("answers a turn quota with the time the next turn may start", async () => {
    const engine = createMemoryEngineChat([agent]);
    engine.refuse(agent, { started: false, refusal: "quota" });
    const chat = createProtocolEngineChat(clientOver(engine, new Map()));
    const posted = engine.post(agent, "hi");
    const { session, turn, message } = posted;
    const start = { agent, session, turn, messages: [message], outsideContent: false };
    await expect(chat.startTurn(start, new AbortController().signal)).resolves.toStrictEqual({
      started: false,
      refusal: "quota",
      resumesAt: 5,
    });
  });

  it("answers a turn the breaker refuses as one of a frozen agent", async () => {
    const engine = createMemoryEngineChat([agent]);
    const chat = createProtocolEngineChat(heldOnTurnStart(clientOver(engine, new Map())));
    const { session, turn, message } = engine.post(agent, "hi");
    const start = { agent, session, turn, messages: [message], outsideContent: false };
    await expect(chat.startTurn(start, new AbortController().signal)).resolves.toStrictEqual({
      started: false,
      refusal: "frozen",
    });
  });

  it("skips a pushed message of a kind the runtime does not know", () => {
    const topics = new Map<string, TopicHandlers>();
    const chat = createProtocolEngineChat(clientOver(createMemoryEngineChat([agent]), topics));
    const seen: string[] = [];
    chat.watchInbox({
      onMessage: (view) => seen.push(view.kind),
      refetch: async () => Promise.resolve(),
    });
    const later = { kind: "inbox/scheduleDue", message: nthTestId("msg", 1), agent };
    topics.get("inbox")?.onPush(pushOf(later, 1));
    expect(seen).toStrictEqual([]);
  });
});
