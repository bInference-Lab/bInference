import { PassThrough } from "node:stream";
import type { ClientStatus } from "@binference/client";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { createFormatter, type MessageLocale } from "@binference/i18n";
import type { PushTopic } from "@binference/protocol";
import { vi } from "vitest";
import type { ChatClient } from "../chat-context.js";
import { type ChatEnd, runTerminalChat } from "../terminal-chat.js";
import { answerAsResult } from "./answer-as-result.schema.js";
import { createScreenEmulator } from "./screen-emulator.js";

/** A fake engine's answers, by operation; an answer may wait, or throw as the engine refuses. */
export type ChatAnswers = Readonly<Record<string, (args: object) => object | Promise<object>>>;

/** One call the fake engine was given. */
interface SeenCall {
  readonly op: string;
  readonly args: object;
}

/** Terminal chat on a fake engine and a fake terminal, and what a test drives and reads. */
export interface ChatHarness {
  readonly calls: readonly SeenCall[];
  readonly clock: ManualClock;
  /** Resolves with how the chat ended. */
  readonly ended: Promise<ChatEnd>;
  /** Delivers a push to the topic's subscriber, as the engine's `push` frame does. */
  push(topic: PushTopic, kind: string, data: object): void;
  /** Types keys into the terminal: text, or control characters such as Ctrl+Y (`\u0019`). */
  press(keys: string): void;
  /** Sets where the client stands, as a lost connection does. */
  setStatus(status: ClientStatus): void;
  /** Lets the chat's calls and prints run. */
  settle(): Promise<void>;
  /** Every row the terminal shows or scrolled off, top first. */
  rows(): readonly string[];
  /** The topics subscribed now. */
  topics(): readonly PushTopic[];
  /** Whether the terminal is in raw mode now. */
  isRaw(): boolean;
  /** Sends a stop signal, as SIGTERM does. */
  stop(): void;
}

/** The agent the harness chats with. */
export const harnessAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
/** 2026-10-19 09:30 UTC, when the harness starts. */
const harnessNowMs: number = Date.UTC(2026, 9, 19, 9, 30, 0);

// Session reads answer an empty session unless the test answers them.
const quiet: ChatAnswers = {
  "chat/messages": () => ({ items: [] }),
  "chat/openQuestion": () => ({}),
  "intent/list": () => ({ items: [] }),
};

function fakeClient(answers: ChatAnswers, calls: SeenCall[]) {
  const subscribers = new Map<PushTopic, Parameters<ChatClient["subscribe"]>[1]>();
  const state: { status: ClientStatus; seq: number } = {
    status: answerAsResult({ state: "ready", ready: {} }),
    seq: 0,
  };
  const all = { ...quiet, ...answers };
  const client: ChatClient = {
    call: async (op, args) => {
      calls.push({ op, args });
      const answer = all[op];
      if (answer === undefined) {
        throw Object.assign(new Error(op), { code: "protocol.unknown_op" });
      }
      return answerAsResult(await answer(args));
    },
    subscribe: (topic, handlers) => {
      subscribers.set(topic, handlers);
      void handlers.refetch(new AbortController().signal);
      return () => {
        subscribers.delete(topic);
      };
    },
    status: () => state.status,
  };
  const push = (topic: PushTopic, kind: string, data: object): void => {
    state.seq += 1;
    subscribers.get(topic)?.onPush({ t: "push", topic, seq: state.seq, kind, data });
  };
  const setStatus = (status: ClientStatus): void => {
    state.status = status;
  };
  return { client, push, setStatus, topics: () => [...subscribers.keys()] };
}

/**
 * Starts terminal chat with the agent `main` on a fake engine that answers from `answers`, in a
 * fake terminal 100 columns wide and 30 rows high, in the owner's language, on a manual clock.
 */
export function startChat(answers: ChatAnswers, locale: MessageLocale = "en"): ChatHarness {
  const calls: SeenCall[] = [];
  const fake = fakeClient(answers, calls);
  const clock = createManualClock(harnessNowMs);
  const input = new PassThrough();
  const output = new PassThrough();
  const screen = createScreenEmulator();
  output.on("data", (chunk: Buffer) => screen.write(chunk.toString("utf8")));
  const raw = { isRaw: false };
  const stopper = new AbortController();
  const ended = runTerminalChat({
    client: fake.client,
    agent: { id: answerAsResult(harnessAgent), name: "main" },
    formatter: createFormatter({ locale, timeZone: "UTC" }),
    terminal: {
      input,
      output,
      enterRawMode: () => {
        raw.isRaw = true;
      },
      leaveRawMode: () => {
        raw.isRaw = false;
      },
      size: () => ({ columns: 100, rows: 30 }),
      onResize: () => () => undefined,
    },
    clock,
    signal: stopper.signal,
  });
  return {
    calls,
    clock,
    ended,
    push: fake.push,
    press: (keys) => input.write(keys),
    setStatus: fake.setStatus,
    // Unit tests run on Vitest's fake timers; the chat's own time is the manual clock.
    settle: async () => {
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
    },
    rows: () => screen.rows(),
    topics: fake.topics,
    isRaw: () => raw.isRaw,
    stop: () => stopper.abort(),
  };
}
