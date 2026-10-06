import type { JsonValue } from "@binference/core";
import { z } from "zod";

/** A token in the Bot API's shape, for tests only. */
export const fakeBotToken = "7012345678:AAE_fakeTokenForTestsOnly_0123456789ab";

/** A message the bot sent. */
interface SentText {
  readonly chatId: number;
  readonly text: string;
  readonly threadId?: number;
}

/** A message the bot deleted. */
interface DeletedMessage {
  readonly chatId: number;
  readonly messageId: number;
}

/** An error answer the Bot API gives instead of a result. */
interface FakeRefusal {
  readonly status: number;
  readonly description: string;
  readonly retryAfterS?: number;
}

/** The `fetch` grammY calls: its own types name an untyped package, so it is spelled out here. */
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Signal = AbortSignal | null | undefined;

/** A Bot API in memory for grammY's `fetch` option: no network, Telegram's offset rules. */
export interface FakeBotApi {
  readonly fetch: Fetch;
  /** Adds updates Telegram holds until a `getUpdates` offset passes them. */
  push(...updates: readonly JsonValue[]): void;
  /** The ids of updates not acknowledged yet. */
  pending(): readonly number[];
  sent(): readonly SentText[];
  deleted(): readonly DeletedMessage[];
  /** The next call of `method` gets this refusal, or a network failure. */
  failNext(method: string, failure: FakeRefusal | "network"): void;
  /** Resolves once a `getUpdates` call waits with nothing to return. */
  idle(): Promise<void>;
}

interface State {
  readonly updates: { readonly id: number; readonly update: JsonValue }[];
  readonly wakers: Set<() => void>;
  readonly idlers: (() => void)[];
  readonly sent: SentText[];
  readonly deleted: DeletedMessage[];
}

type Handler = (body: string, signal: Signal) => Promise<Response>;

const pollSchema = z.looseObject({ offset: z.int().optional(), limit: z.int().optional() });
const sendSchema = z.looseObject({
  chat_id: z.int(),
  text: z.string(),
  message_thread_id: z.int().optional(),
});
const deleteSchema = z.looseObject({ chat_id: z.int(), message_id: z.int() });
const headSchema = z.looseObject({ update_id: z.int() });

function answer(result: JsonValue): Response {
  return new Response(JSON.stringify({ ok: true, result }));
}

function refuse(failure: FakeRefusal): Response {
  const parameters = failure.retryAfterS === undefined ? {} : { retry_after: failure.retryAfterS };
  const { status, description } = failure;
  return new Response(JSON.stringify({ ok: false, error_code: status, description, parameters }));
}

function urlOf(input: Parameters<Fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

// Waits like a long poll: until an update is pushed or the request is aborted.
async function waitForUpdate(state: State, signal: Signal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const wake = (): void => {
      state.wakers.delete(wake);
      resolve();
    };
    state.wakers.add(wake);
    signal?.addEventListener("abort", () => {
      state.wakers.delete(wake);
      reject(new Error("The request was aborted."));
    });
    for (const idler of state.idlers.splice(0)) {
      idler();
    }
  });
}

function handlersOf(state: State): Readonly<Record<string, Handler>> {
  let lastMessageId = 1000;
  return {
    getUpdates: async (body, signal) => {
      const { offset, limit } = pollSchema.parse(JSON.parse(body));
      const kept = state.updates.filter((held) => offset === undefined || held.id >= offset);
      state.updates.splice(0, state.updates.length, ...kept);
      if (state.updates.length === 0) {
        await waitForUpdate(state, signal);
      }
      return answer(state.updates.slice(0, limit ?? 100).map((held) => held.update));
    },
    sendMessage: async (body) => {
      const message = sendSchema.parse(JSON.parse(body));
      const threadId = message.message_thread_id;
      const chatId = message.chat_id;
      state.sent.push({
        chatId,
        text: message.text,
        ...(threadId === undefined ? {} : { threadId }),
      });
      lastMessageId += 1;
      const chat = { id: chatId, type: "private" };
      return Promise.resolve(
        answer({ message_id: lastMessageId, date: 1, chat, text: message.text }),
      );
    },
    deleteMessage: async (body) => {
      const target = deleteSchema.parse(JSON.parse(body));
      state.deleted.push({ chatId: target.chat_id, messageId: target.message_id });
      return Promise.resolve(answer(true));
    },
  };
}

function fetchOf(state: State, failures: Map<string, FakeRefusal | "network">): Fetch {
  const handlers = handlersOf(state);
  return async (input, init) => {
    const url = urlOf(input);
    const [botPart, method = ""] = new URL(url).pathname.split("/").slice(-2);
    const failure = failures.get(method);
    failures.delete(method);
    if (failure === "network") {
      throw new Error(`request to ${url} failed, reason: connect ECONNREFUSED`);
    }
    const handler = handlers[method];
    if (failure !== undefined || botPart !== `bot${fakeBotToken}` || handler === undefined) {
      return refuse(failure ?? { status: 401, description: "Unauthorized" });
    }
    return handler(typeof init?.body === "string" ? init.body : "{}", init?.signal);
  };
}

/** Creates an empty in-memory Bot API that accepts {@link fakeBotToken} only. */
export function createFakeBotApi(): FakeBotApi {
  const state: State = { updates: [], wakers: new Set(), idlers: [], sent: [], deleted: [] };
  const failures = new Map<string, FakeRefusal | "network">();
  return {
    fetch: fetchOf(state, failures),
    push: (...updates) => {
      const held = updates.map((update) => ({ id: headSchema.parse(update).update_id, update }));
      state.updates.push(...held);
      for (const wake of state.wakers) {
        wake();
      }
    },
    pending: () => state.updates.map((held) => held.id),
    sent: () => [...state.sent],
    deleted: () => [...state.deleted],
    failNext: (method, failure) => {
      failures.set(method, failure);
    },
    idle: async () =>
      new Promise((resolve) => {
        if (state.wakers.size > 0 && state.updates.length === 0) {
          resolve();
        } else {
          state.idlers.push(resolve);
        }
      }),
  };
}
