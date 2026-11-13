import type { TopicHandlers } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type InboxMessageView,
  inboxMessageViewSchema,
  type PushFrame,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { engineChatContract } from "../contracts/engine-chat-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "../testing/memory-engine-chat.js";
import { createCallSlots } from "./call-slots.js";
import type { EngineChat } from "./ports.js";
import { type ChatClient, createProtocolEngineChat } from "./protocol-engine-chat.js";
import { createResendingClient } from "./resending-client.js";

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

// The engine's side of chat over the client, sending again what the engine refused unrun.
function chatOver(client: ChatClient): EngineChat {
  const ports = { clock: createManualClock(0), random: createSeededRandom(5) };
  return createProtocolEngineChat(
    client,
    createResendingClient(createCallSlots(client, ports.clock), ports),
  );
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

const busy = new BinferenceError({ code: "protocol.busy", message: "busy", retryable: true });

// A client that refuses each operation's first call busy and answers the rest, noting each
// attempt's operation and key.
function busyOnce() {
  const attempts: { readonly op: string; readonly key?: string }[] = [];
  const refused = new Set<string>();
  const client: ChatClient = {
    async call(op, _args, options) {
      attempts.push({ op, ...(options.key === undefined ? {} : { key: options.key }) });
      if (!refused.has(op)) {
        refused.add(op);
        throw busy;
      }
      return (op === "usage/record" ? { budgetLeftMicros: 5n } : {}) as never;
    },
    subscribe: () => () => undefined,
  };
  return { client, attempts };
}

// Each operation's keys, in the order its attempts went.
function keysByOp(attempts: readonly { readonly op: string; readonly key?: string }[]) {
  return Object.fromEntries(
    [...new Set(attempts.map(({ op }) => op))].map((op) => [
      op,
      attempts.filter((attempt) => attempt.op === op).map(({ key }) => key ?? "none"),
    ]),
  );
}

const place = { agent, turn: nthTestId("trn", 1) };
const sessionId = nthTestId("ses", 1);

describe("createProtocolEngineChat", () => {
  it.each(
    engineChatContract({
      create: async () => {
        const engine = createMemoryEngineChat([agent]);
        const topics = new Map<string, TopicHandlers>();
        const chat = chatOver(clientOver(engine, topics));
        const watching = chatOver({
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
    const chat = chatOver(clientOver(engine, new Map()));
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
    const chat = chatOver(clientOver(engine, new Map()));
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
    const chat = chatOver(heldOnTurnStart(clientOver(engine, new Map())));
    const { session, turn, message } = engine.post(agent, "hi");
    const start = { agent, session, turn, messages: [message], outsideContent: false };
    await expect(chat.startTurn(start, new AbortController().signal)).resolves.toStrictEqual({
      started: false,
      refusal: "frozen",
    });
  });

  it("skips a pushed message of a kind the runtime does not know", () => {
    const topics = new Map<string, TopicHandlers>();
    const chat = chatOver(clientOver(createMemoryEngineChat([agent]), topics));
    const seen: string[] = [];
    chat.watchInbox({
      onMessage: (view) => seen.push(view.kind),
      refetch: async () => Promise.resolve(),
    });
    const later = { kind: "inbox/scheduleDue", message: nthTestId("msg", 1), agent };
    topics.get("inbox")?.onPush(pushOf(later, 1));
    expect(seen).toStrictEqual([]);
  });

  it("sends a turn's closing calls again when refused busy, each write under one key", async () => {
    const clock = createManualClock(0);
    const { client, attempts } = busyOnce();
    const chat = createProtocolEngineChat(
      client,
      createResendingClient(createCallSlots(client, clock), {
        clock,
        random: createSeededRandom(5),
      }),
    );
    const signal = new AbortController().signal;
    const usage = { model: "m", inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdMicros: 0n };
    const sent = Promise.all([
      chat.markTurn(place, signal),
      chat.sayTurn({ ...place, session: sessionId, text: "Done.", final: true }, signal),
      chat.turnStatus({ ...place, statusKey: "turn.failed" }, signal),
      chat.recordUsage({ ...place, ...usage, key: "trn.usage.1" }, signal),
      chat.endTurn({ ...place, outcome: "ok" }, signal),
    ]);
    await clock.advance(8_000);
    await sent;
    const keys = keysByOp(attempts);
    expect(keys["turn/mark"]).toHaveLength(2);
    expect(new Set(keys["turn/mark"]).size).toBe(1);
    expect(keys).toMatchObject({
      "turn/say": [`${place.turn}.say`, `${place.turn}.say`],
      "turn/status": ["none", "none"],
      "usage/record": ["trn.usage.1", "trn.usage.1"],
      "turn/end": [`${place.turn}.end`, `${place.turn}.end`],
    });
  });

  it("sends a draft, a progress line and reasoning once, even when refused busy", async () => {
    const clock = createManualClock(0);
    const { client, attempts } = busyOnce();
    const chat = createProtocolEngineChat(
      client,
      createResendingClient(createCallSlots(client, clock), {
        clock,
        random: createSeededRandom(5),
      }),
    );
    const signal = new AbortController().signal;
    const sent = Promise.allSettled([
      chat.sayTurn({ ...place, session: sessionId, text: "Dra", final: false }, signal),
      chat.turnProgress({ ...place, progressKey: "turn.tool.portfolio" }, signal),
      chat.turnReasoning({ ...place, text: "Hmm", final: true }, signal),
    ]);
    await clock.advance(8_000);
    expect((await sent).map(({ status }) => status)).toStrictEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(attempts.map(({ op }) => op)).toStrictEqual([
      "turn/say",
      "turn/progress",
      "turn/reasoning",
    ]);
  });
});
