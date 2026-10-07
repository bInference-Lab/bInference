import type { JsonValue } from "@binference/core";
import { z } from "zod";
import {
  type CallbackAnswer,
  createFakeChats,
  type DeletedMessage,
  type FakeChats,
  type FakeEdit,
  type FakeMessage,
  type SentText,
} from "./fake-chat.js";

/** A token in the Bot API's shape, for tests only. */
export const fakeBotToken = "7012345678:AAE_fakeTokenForTestsOnly_0123456789ab";

/** An error answer the Bot API gives instead of a result. */
export interface FakeRefusal {
  readonly status: number;
  readonly description: string;
  readonly retryAfterS?: number;
}

/** A press of an inline button, as Telegram reports it to the bot. */
export interface FakePress {
  /** The presser's numeric Telegram id. */
  readonly from: number;
  /** The callback data the button carries, or any text a forged press sends. */
  readonly data: string;
  /** The message the button sits on. */
  readonly messageId: number;
  /** The chat of that message; the presser's private chat by default. */
  readonly chatId?: number;
  readonly chatType?: string;
  readonly isBot?: boolean;
  readonly languageCode?: string;
}

/** One request that reached the Bot API. */
export interface FakeCall {
  readonly method: string;
  readonly chatId?: number;
}

/** The `fetch` grammY calls: its own types name an untyped package, so it is spelled out here. */
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Signal = AbortSignal | null | undefined;

/**
 * A synthetic Telegram Bot API in memory for grammY's `fetch` option: no network. Updates come
 * in under Telegram's offset rules; messages, edits, deletes and button answers go out with the
 * Bot API's checks (HTML parse mode, 4,096 characters, 64-byte callback data, one answer per
 * press, no edit that changes nothing).
 */
export interface FakeBotApi {
  readonly fetch: Fetch;
  /** Adds updates Telegram holds until a `getUpdates` offset passes them. */
  push(...updates: readonly JsonValue[]): void;
  /** Presses a button: pushes the `callback_query` update and returns it. */
  press(press: FakePress): JsonValue;
  /** The ids of updates not acknowledged yet. */
  pending(): readonly number[];
  /** The messages as sent, with the text a reader saw then. */
  sent(): readonly SentText[];
  /** Every message the bot sent, as it stands now. */
  messages(): readonly FakeMessage[];
  deleted(): readonly DeletedMessage[];
  edits(): readonly FakeEdit[];
  /** The bot's answers to button presses, in order. */
  answers(): readonly CallbackAnswer[];
  /** Every request in the order it arrived, refused ones too. */
  calls(): readonly FakeCall[];
  /**
   * The next call of `method` gets this refusal, or a network failure. With `chatId`, the next
   * call of that method to that chat does.
   */
  failNext(
    method: string,
    failure: FakeRefusal | "network",
    target?: { readonly chatId: number },
  ): void;
  /** Resolves once a `getUpdates` call waits with nothing to return. */
  idle(): Promise<void>;
}

interface Failure {
  readonly method: string;
  readonly failure: FakeRefusal | "network";
  readonly chatId?: number;
}

interface State {
  readonly updates: { readonly id: number; readonly update: JsonValue }[];
  readonly wakers: Set<() => void>;
  readonly idlers: (() => void)[];
  readonly failures: Failure[];
  readonly calls: FakeCall[];
  readonly chats: FakeChats;
}

const pollSchema = z.looseObject({ offset: z.int().optional(), limit: z.int().optional() });
const headSchema = z.looseObject({ update_id: z.int() });
const chatSchema = z.looseObject({ chat_id: z.int().optional() });
const pressBase = 9000;

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

async function getUpdates(state: State, body: string, signal: Signal): Promise<Response> {
  const { offset, limit } = pollSchema.parse(JSON.parse(body));
  const kept = state.updates.filter((held) => offset === undefined || held.id >= offset);
  state.updates.splice(0, state.updates.length, ...kept);
  if (state.updates.length === 0) {
    await waitForUpdate(state, signal);
  }
  return answer(state.updates.slice(0, limit ?? 100).map((held) => held.update));
}

// The first failure set for this call: its method, and its chat when the failure names one.
function takeFailure(state: State, call: FakeCall): FakeRefusal | "network" | undefined {
  const index = state.failures.findIndex(
    (failure) =>
      failure.method === call.method &&
      (failure.chatId === undefined || failure.chatId === call.chatId),
  );
  return index === -1 ? undefined : state.failures.splice(index, 1)[0]?.failure;
}

/** One request as the fake reads it: its method and chat, its body and its signal. */
interface FakeRequest {
  readonly call: FakeCall;
  readonly bot: string;
  readonly url: string;
  readonly body: string;
  readonly signal: Signal;
}

async function serve(state: State, request: FakeRequest): Promise<Response> {
  const { call, body } = request;
  if (call.method === "getUpdates") {
    return getUpdates(state, body, request.signal);
  }
  const chatCall = state.chats.calls[call.method];
  const result = chatCall?.(body);
  if (result === undefined) {
    return refuse({ status: 404, description: "Not Found: method not found" });
  }
  return result.ok ? answer(result.value) : refuse({ status: 400, description: result.error });
}

function requestOf(input: Parameters<Fetch>[0], init: RequestInit | undefined): FakeRequest {
  const url = urlOf(input);
  const [bot = "", method = ""] = new URL(url).pathname.split("/").slice(-2);
  const body = typeof init?.body === "string" ? init.body : "{}";
  const chatId = chatSchema.safeParse(JSON.parse(body)).data?.chat_id;
  const call = { method, ...(chatId === undefined ? {} : { chatId }) };
  return { call, bot, url, body, signal: init?.signal };
}

function fetchOf(state: State): Fetch {
  return async (input, init) => {
    const request = requestOf(input, init);
    state.calls.push(request.call);
    const failure = takeFailure(state, request.call);
    if (failure === "network") {
      throw new Error(`request to ${request.url} failed, reason: connect ECONNREFUSED`);
    }
    if (failure !== undefined || request.bot !== `bot${fakeBotToken}`) {
      return refuse(failure ?? { status: 401, description: "Unauthorized" });
    }
    return serve(state, request);
  };
}

function callbackUpdate(press: FakePress, updateId: number): JsonValue {
  const chat = { id: press.chatId ?? press.from, type: press.chatType ?? "private" };
  const language = press.languageCode === undefined ? {} : { language_code: press.languageCode };
  return {
    update_id: updateId,
    callback_query: {
      id: `press-${String(updateId)}`,
      from: { id: press.from, is_bot: press.isBot ?? false, first_name: "Fixture", ...language },
      chat_instance: "1",
      data: press.data,
      message: { message_id: press.messageId, date: 1, chat },
    },
  };
}

/** Creates an empty in-memory Bot API that accepts {@link fakeBotToken} only. */
export function createFakeBotApi(): FakeBotApi {
  const chats = createFakeChats();
  const state: State = {
    updates: [],
    wakers: new Set(),
    idlers: [],
    failures: [],
    calls: [],
    chats,
  };
  let presses = 0;
  const push = (...updates: readonly JsonValue[]): void => {
    const held = updates.map((update) => ({ id: headSchema.parse(update).update_id, update }));
    state.updates.push(...held);
    for (const wake of state.wakers) {
      wake();
    }
  };
  return {
    fetch: fetchOf(state),
    push,
    press: (press) => {
      presses += 1;
      const update = callbackUpdate(press, pressBase + presses);
      push(update);
      return update;
    },
    pending: () => state.updates.map((held) => held.id),
    sent: () => chats.sent(),
    messages: () => chats.messages(),
    deleted: () => chats.deleted(),
    edits: () => chats.edits(),
    answers: () => chats.answers(),
    calls: () => [...state.calls],
    failNext: (method, failure, target) => {
      state.failures.push({ method, failure, ...target });
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
