import type { Http, HttpDownload, JsonValue } from "@binference/core";
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
import { createFakeMenus, type FakeMenu, type FakeMenus } from "./fake-commands.js";
import { createFakeFiles, type FakeFile, type FakeFiles } from "./fake-files.js";
import type { FakeTopic } from "./fake-topics.js";
import { downloadOverFetch, httpOverFetch } from "./fetch-http.js";

/** A token in the Bot API's shape, for tests only. */
export const fakeBotToken = "7012345678:AAE_fakeTokenForTestsOnly_0123456789ab";

/** The Bot API base for {@link fakeBotToken}: Telegram reads the token from the path. */
export const fakeBotApiBase: string = "https://api.telegram.org/bot" + fakeBotToken;

/** The username of the bot {@link fakeBotToken} opens, as `getMe` answers it. */
export const fakeBotUsername = "binference_test_bot";

// `getMe`'s answer for the fake bot: a `User` with the fields Telegram returns only to getMe.
const fakeBotUser = {
  id: 7_012_345_678,
  is_bot: true,
  first_name: "binference test",
  username: fakeBotUsername,
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

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
 * press, no edit that changes nothing), and command menus with `setMyCommands`'s limits.
 */
export interface FakeBotApi {
  readonly fetch: Fetch;
  /** The same Bot API behind the Http port, as binference's outbound HTTP reaches Telegram. */
  readonly http: Http;
  /** The same Bot API's file downloads, as binference's outbound HTTP reaches them. */
  readonly download: HttpDownload;
  /** Holds a file the bot may read with `getFile` and download, as a photo the owner sent. */
  addFile(fileId: string, file: FakeFile): void;
  /** How many file downloads came in. */
  downloads(): number;
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
  /** The command menus the bot set with `setMyCommands`. */
  menus(): readonly FakeMenu[];
  /** The topics the bot made in private chats, deleted ones left out. */
  topics(): readonly FakeTopic[];
  /** Deletes a topic, as the owner may: a message to it is refused from then on. */
  deleteTopic(chatId: number, threadId: number): void;
  /** Every request in the order it arrived, refused ones too. */
  calls(): readonly FakeCall[];
  /**
   * The next call of `method` gets this refusal, or a network failure: `network` before the
   * request reaches the Bot API (the connection is refused), `lostAnswer` after the Bot API did
   * the call (the connection resets before its answer). With `chatId`, the next call of that
   * method to that chat does.
   */
  failNext(method: string, failure: FakeFailure, target?: { readonly chatId: number }): void;
  /** Resolves once a `getUpdates` call waits with nothing to return. */
  idle(): Promise<void>;
}

/** How {@link FakeBotApi.failNext} fails a call. */
export type FakeFailure = FakeRefusal | "network" | "lostAnswer";

interface Failure {
  readonly method: string;
  readonly failure: FakeFailure;
  readonly chatId?: number;
}

interface State {
  readonly user: JsonValue;
  readonly updates: { readonly id: number; readonly update: JsonValue }[];
  readonly wakers: Set<() => void>;
  readonly idlers: (() => void)[];
  readonly failures: Failure[];
  readonly calls: FakeCall[];
  readonly chats: FakeChats;
  readonly menus: FakeMenus;
  readonly files: FakeFiles;
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
function takeFailure(state: State, call: FakeCall): FakeFailure | undefined {
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

// The calls the fake answers outside its chats: the command menus and the files.
function ownCallOf(state: State, method: string) {
  if (method === "setMyCommands") {
    return (body: string) => state.menus.setMyCommands(body);
  }
  return method === "getFile" ? (body: string) => state.files.getFile(body) : undefined;
}

async function serve(state: State, request: FakeRequest): Promise<Response> {
  const { call, body } = request;
  if (call.method === "getUpdates") {
    return getUpdates(state, body, request.signal);
  }
  if (call.method === "getMe") {
    return answer(state.user);
  }
  const chatCall = ownCallOf(state, call.method) ?? state.chats.calls[call.method];
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

// A failed request as Node's fetch reports it, with the socket's code.
function networkError(url: string, code: string): Error {
  return Object.assign(new Error(`request to ${url} failed, reason: ${code}`), { code });
}

// A file's download, `/file/bot<token>/<path>`, which only the bot's own token opens.
const filePath = /^\/file\/bot([^/]+)\/(.+)$/u;

function fetchOf(state: State): Fetch {
  return async (input, init) => {
    const file = filePath.exec(new URL(urlOf(input)).pathname);
    if (file !== null) {
      return file[1] === fakeBotToken && file[2] !== undefined
        ? state.files.download(file[2])
        : new Response("", { status: 404 });
    }
    const request = requestOf(input, init);
    state.calls.push(request.call);
    const failure = takeFailure(state, request.call);
    if (failure === "network") {
      throw networkError(request.url, "ECONNREFUSED");
    }
    if (failure === "lostAnswer") {
      await serve(state, request);
      throw networkError(request.url, "ECONNRESET");
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

// Resolves once the poller waits on an empty queue.
async function idleOf(state: State): Promise<void> {
  return new Promise((resolve) => {
    if (state.wakers.size > 0 && state.updates.length === 0) {
      resolve();
    } else {
      state.idlers.push(resolve);
    }
  });
}

// The files the bot may read, as a test adds them, and the downloads that came in.
function filesOf(state: State): Pick<FakeBotApi, "addFile" | "downloads"> {
  return {
    addFile: (fileId, file) => {
      state.files.add(fileId, file);
    },
    downloads: () => state.files.downloads(),
  };
}

// The fetch grammY calls, and binference's outbound HTTP over it.
function transportsOver(fetch: Fetch): Pick<FakeBotApi, "fetch" | "http" | "download"> {
  return { fetch, http: httpOverFetch(fetch), download: downloadOverFetch(fetch) };
}

/** How the synthetic Bot API's bot is set up at BotFather. */
export interface FakeBotOptions {
  /** Whether topics in private chats are on, which `getMe` reports as `has_topics_enabled`. */
  readonly hasTopics?: boolean;
}

// The fake's state before any call: its chats send again only the files the bot holds.
function emptyState({ hasTopics = false }: FakeBotOptions): State {
  const files = createFakeFiles();
  const chats = createFakeChats({ hasTopics, fileKindOf: (id) => files.kindOf(id) });
  return {
    user: { ...fakeBotUser, has_topics_enabled: hasTopics, allows_users_to_create_topics: false },
    updates: [],
    wakers: new Set(),
    idlers: [],
    failures: [],
    calls: [],
    chats,
    menus: createFakeMenus(),
    files,
  };
}

/** Creates an empty in-memory Bot API that accepts {@link fakeBotToken} only. */
export function createFakeBotApi(options: FakeBotOptions = {}): FakeBotApi {
  const state = emptyState(options);
  const { chats } = state;
  let presses = 0;
  const push = (...updates: readonly JsonValue[]): void => {
    const held = updates.map((update) => ({ id: headSchema.parse(update).update_id, update }));
    state.updates.push(...held);
    for (const wake of state.wakers) {
      wake();
    }
  };
  return {
    ...transportsOver(fetchOf(state)),
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
    menus: () => state.menus.menus(),
    topics: () => chats.topics(),
    deleteTopic: (chatId, threadId) => {
      chats.deleteTopic(chatId, threadId);
    },
    calls: () => [...state.calls],
    ...filesOf(state),
    failNext: (method, failure, target) => {
      state.failures.push({ method, failure, ...target });
    },
    idle: async () => idleOf(state),
  };
}
