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
          const code = `agent.${started.refusal}` as const;
          const details = started.refusal === "budget" ? { resumesAt: 5 } : {};
          throw new BinferenceError({ code, message: "refused", details });
        }
        return { budgetLeftMicros: started.budgetLeftMicros };
      }
      case "turn/mark":
        return engine.markTurn(args as never, signal).then(() => ({}));
      case "turn/say":
        return engine.sayTurn(args as never, signal).then(() => ({}));
      case "turn/status":
        return engine.turnStatus(args as never, signal).then(() => ({}));
      default:
        return engine.endTurn(args as never, signal).then(() => ({}));
    }
  };
  return {
    call: async (op: string, args: Record<string, unknown>, options: { signal: AbortSignal }) =>
      answer(op, args, options.signal),
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
