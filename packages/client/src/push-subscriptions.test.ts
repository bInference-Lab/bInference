import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import type { ArgsOf, PushFrame, PushTopic, ResultOf } from "@binference/protocol";
import { describe, expect, it, vi } from "vitest";
import { createPushSubscriptions, type TopicHandlers } from "./push-subscriptions.js";

type SubscribeArgs = ArgsOf<"push/subscribe">;
type SubscribeResult = ResultOf<"push/subscribe">;

// Enough microtask turns for a reply to reach the subscriptions and a load to start or end.
async function settle(turns = 20): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

function push(seq: number, topic: PushTopic = "intent"): PushFrame {
  return { t: "push", topic, seq, kind: "intent/changed", data: { seq } };
}

// The engine's side of push/subscribe: each request waits until the test answers it.
function setup() {
  const requests: SubscribeArgs[] = [];
  const replies: { resolve: (reply: SubscribeResult) => void; reject: (error: Error) => void }[] =
    [];
  const unsubscribed: PushTopic[] = [];
  const connection = { isUp: true };
  const logger = createMemoryLogger({ subsystem: "client" });
  const subscriptions = createPushSubscriptions({
    maxTopics: 2,
    logger,
    isConnected: () => connection.isUp,
    subscribe: async (args) => {
      requests.push(args);
      return new Promise<SubscribeResult>((resolve, reject) => {
        replies.push({ resolve, reject });
      });
    },
    unsubscribe: async (topic) => {
      unsubscribed.push(topic);
    },
  });
  const answer = async (reply: SubscribeResult): Promise<void> => {
    replies.shift()?.resolve(reply);
    await settle();
  };
  const refuse = async (error: Error): Promise<void> => {
    replies.shift()?.reject(error);
    await settle();
  };
  return { subscriptions, requests, answer, refuse, unsubscribed, connection, logger };
}

// A subscriber whose loads finish when the test says so.
function subscriber() {
  const seen: number[] = [];
  const finishers: (() => void)[] = [];
  const refetch = vi.fn<TopicHandlers["refetch"]>(
    async () =>
      new Promise<void>((resolve) => {
        finishers.push(resolve);
      }),
  );
  const handlers: TopicHandlers = { onPush: (frame) => seen.push(frame.seq), refetch };
  const finishLoad = async (): Promise<void> => {
    finishers.shift()?.();
    await settle();
  };
  return { handlers, seen, refetch, finishLoad };
}

describe("createPushSubscriptions", () => {
  it("loads a new topic once, then delivers its pushes in order", async () => {
    const { subscriptions, requests, answer } = setup();
    const { handlers, seen, refetch, finishLoad } = subscriber();
    subscriptions.add("intent", handlers);
    expect(requests).toStrictEqual([{ topics: { intent: {} } }]);
    await answer({ seqs: { intent: 3 } });
    expect(refetch).toHaveBeenCalledOnce();
    subscriptions.receive(push(4));
    await finishLoad();
    subscriptions.receive(push(5));
    subscriptions.receive(push(6));
    expect(seen).toStrictEqual([5, 6]);
    expect(requests).toHaveLength(1);
  });

  it("refetches exactly once for a skipped seq, however many pushes follow during the load", async () => {
    const { subscriptions, requests, answer } = setup();
    const { handlers, seen, refetch, finishLoad } = subscriber();
    subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 3 } });
    await finishLoad();
    subscriptions.receive(push(4));
    subscriptions.receive(push(6));
    subscriptions.receive(push(7));
    subscriptions.receive(push(9));
    expect(refetch).toHaveBeenCalledTimes(2);
    await finishLoad();
    expect(requests.at(-1)).toStrictEqual({ topics: { intent: { fromSeq: 10 } } });
    await answer({ seqs: { intent: 9 } });
    subscriptions.receive(push(10));
    expect(seen).toStrictEqual([4, 10]);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("skips a push it has already seen", async () => {
    const { subscriptions, answer } = setup();
    const { handlers, seen, finishLoad } = subscriber();
    subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 0 } });
    await finishLoad();
    subscriptions.receive(push(1));
    subscriptions.receive(push(1));
    subscriptions.receive(push(2));
    expect(seen).toStrictEqual([1, 2]);
  });

  it("subscribes again from the push after the last one seen when a connection is new", async () => {
    const { subscriptions, requests, answer } = setup();
    const { handlers, seen, refetch, finishLoad } = subscriber();
    subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 3 } });
    await finishLoad();
    subscriptions.receive(push(4));
    subscriptions.resume();
    expect(requests.at(-1)).toStrictEqual({ topics: { intent: { fromSeq: 5 } } });
    await answer({ seqs: { intent: 6 } });
    subscriptions.receive(push(5));
    subscriptions.receive(push(6));
    expect(seen).toStrictEqual([4, 5, 6]);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "the engine no longer holds the missed pushes",
      { seqs: { intent: 40 }, resync: ["intent"] },
      41,
    ],
    ["the engine's seq went back after a restart", { seqs: { intent: 2 } }, 3],
  ] as const)("refetches when %s", async (_case, reply: SubscribeResult, next: number) => {
    const { subscriptions, requests, answer } = setup();
    const { handlers, seen, refetch, finishLoad } = subscriber();
    subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 3 } });
    await finishLoad();
    subscriptions.receive(push(4));
    subscriptions.resume();
    await answer(reply);
    expect(refetch).toHaveBeenCalledTimes(2);
    await finishLoad();
    expect(requests.at(-1)).toStrictEqual({ topics: { intent: { fromSeq: next } } });
    await answer({ seqs: { intent: next - 1 } });
    subscriptions.receive(push(next));
    expect(seen).toStrictEqual([4, next]);
  });

  it("subscribes nothing while disconnected and every topic on the next connection", async () => {
    const { subscriptions, requests, connection } = setup();
    connection.isUp = false;
    subscriptions.add("intent", subscriber().handlers);
    subscriptions.add("order", subscriber().handlers);
    expect(requests).toStrictEqual([]);
    connection.isUp = true;
    subscriptions.resume();
    expect(requests).toStrictEqual([{ topics: { intent: {}, order: {} } }]);
  });

  it("refuses a second subscriber of a topic and a topic over the bound as busy", () => {
    const { subscriptions } = setup();
    subscriptions.add("intent", subscriber().handlers);
    expect(() => subscriptions.add("intent", subscriber().handlers)).toThrow(
      expect.objectContaining({ code: "client.busy" }),
    );
    subscriptions.add("order", subscriber().handlers);
    expect(() => subscriptions.add("ledger", subscriber().handlers)).toThrow(
      expect.objectContaining({ code: "client.busy" }),
    );
  });

  it("stops the load and leaves the engine's topic when the subscription ends", async () => {
    const { subscriptions, answer, unsubscribed } = setup();
    const { handlers, seen, refetch } = subscriber();
    const unsubscribe = subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 3 } });
    unsubscribe();
    unsubscribe();
    expect(refetch.mock.calls[0]?.[0].aborted).toBe(true);
    expect(unsubscribed).toStrictEqual(["intent"]);
    subscriptions.receive(push(4));
    expect(seen).toStrictEqual([]);
  });

  it("logs a failed load and a throwing subscriber without stopping", async () => {
    const { subscriptions, answer, logger, requests } = setup();
    const refetch = vi.fn<TopicHandlers["refetch"]>(async () => {
      throw new BinferenceError({ code: "intent.not_found", message: "Gone." });
    });
    const onPush = vi.fn<TopicHandlers["onPush"]>(() => {
      throw new Error("Subscriber bug.");
    });
    subscriptions.add("intent", { onPush, refetch });
    await answer({ seqs: { intent: 0 } });
    subscriptions.receive(push(1));
    subscriptions.receive(push(2));
    await settle();
    expect(onPush).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
    expect(logger.records().map((record) => [record.event, record.fields])).toStrictEqual([
      ["client.refetch_failed", { errorCode: "intent.not_found" }],
      ["client.push_failed", { errorCode: "unexpected" }],
      ["client.push_failed", { errorCode: "unexpected" }],
    ]);
  });

  it("logs a refused subscribe and tries again on the next connection", async () => {
    const { subscriptions, refuse, answer, requests, logger } = setup();
    const { handlers, refetch } = subscriber();
    subscriptions.add("intent", handlers);
    await refuse(new BinferenceError({ code: "auth.scope", message: "No." }));
    expect(logger.records().map((record) => record.fields)).toStrictEqual([
      { errorCode: "auth.scope" },
    ]);
    subscriptions.resume();
    await answer({ seqs: { intent: 0 } });
    expect(requests).toStrictEqual([{ topics: { intent: {} } }, { topics: { intent: {} } }]);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("drops every topic and stops every load on clear", async () => {
    const { subscriptions, answer, requests } = setup();
    const { handlers, refetch } = subscriber();
    subscriptions.add("intent", handlers);
    await answer({ seqs: { intent: 0 } });
    subscriptions.clear();
    subscriptions.resume();
    expect(refetch.mock.calls[0]?.[0].aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });
});
