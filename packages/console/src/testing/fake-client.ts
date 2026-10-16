import type { ProtocolClient, TopicHandlers } from "@binference/client";
import {
  type PushTopic,
  type ReadyFrame,
  readyFrameSchema,
  type Scope,
} from "@binference/protocol";
import { fakeAnswerOf } from "./fake-answer.schema";

/** Every scope a paired console device holds. */
export const consoleScopes: readonly Scope[] = [
  "read",
  "propose",
  "chat",
  "confirm",
  "loosen",
  "admin",
];

/** The engine's `ready` for a connection with these scopes, for an owner in the locale. */
export function readyWith(scopes: readonly Scope[], locale: "en" | "zh" = "en"): ReadyFrame {
  return readyFrameSchema.parse({
    t: "ready",
    v: 1,
    connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    scopes,
    engine: { version: "2026.10.0", protocol: 1, state: "ready" },
    owner: { locale, timezone: "UTC" },
  });
}

/** One call the fake engine answered. */
interface SeenCall {
  readonly op: string;
  readonly args: object;
}

/** The answers of a fake engine, by operation; an answer may wait, or reject as the engine fails. */
export type FakeAnswers = Readonly<Record<string, (args: object) => object | Promise<object>>>;

/** A fake engine's client, the calls it was given, and a way to send it pushes. */
export interface FakeClient {
  readonly client: ProtocolClient;
  readonly calls: readonly SeenCall[];
  /** Delivers a push to the topic's subscriber, as the engine's `push` frame would. */
  push(topic: PushTopic, kind: string, data: object): void;
}

/** A client that answers each call from `answers` and keeps every call it was given. */
export function fakeClient(answers: FakeAnswers): FakeClient {
  const calls: SeenCall[] = [];
  const subscribers = new Map<PushTopic, TopicHandlers>();
  const seqs = new Map<PushTopic, number>();
  const ready = readyWith(consoleScopes);
  const client: ProtocolClient = {
    connect: async () => Promise.resolve(ready),
    call: async (op, args) => {
      calls.push({ op, args });
      const answer = answers[op];
      if (answer === undefined) {
        throw Object.assign(new Error(op), { code: "protocol.unknown_op" });
      }
      return fakeAnswerOf(await answer(args));
    },
    subscribe: (topic, handlers) => {
      subscribers.set(topic, handlers);
      return () => {
        subscribers.delete(topic);
      };
    },
    status: () => ({ state: "ready", ready }),
    close: () => undefined,
  };
  return {
    client,
    calls,
    push(topic, kind, data) {
      const seq = (seqs.get(topic) ?? 0) + 1;
      seqs.set(topic, seq);
      subscribers.get(topic)?.onPush({ t: "push", topic, seq, kind, data });
    },
  };
}
