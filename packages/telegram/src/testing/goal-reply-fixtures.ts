import type { JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger, type ManualClock } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import type { MessageLocale } from "@binference/i18n";
import { Api } from "grammy";
import { type ChatReplies, createChatReplies } from "../chat/chat-replies.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "./fake-bot-api.js";
import { ownerId } from "./update-fixtures.js";

// What the tests of a chat's goal in Telegram show: a goal, its progress note, and the replies.

/** A call nothing stops. */
export const live: { readonly signal: AbortSignal } = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";

/** A push of a chat topic, as the relay hands it to the replies. */
interface GoalPushWire {
  readonly kind: string;
  readonly data: JsonValue;
}

/** A `chat/goal` push of a change, with the goal or note it carries. */
export function push(change: string, extra: { readonly [key: string]: JsonValue }): GoalPushWire {
  return { kind: "chat/goal", data: { agent, session, change, ...extra } };
}

/** A chat's goal as `chat/goal` carries it. */
export const goal: { readonly [key: string]: JsonValue } = {
  agent,
  session,
  objective: "Find three tokens",
  status: "active",
  spentUsdMicros: "0",
  goalTurns: 0,
  startedAt: 1,
  updatedAt: 1,
};

/** A progress note of two steps, the first done once `done` is above zero. */
export function noteOf(done: number): JsonValue {
  return {
    agent,
    session,
    markdown: `${String(done)} of 2 done.`,
    plan: [
      { text: "Scan", state: done > 0 ? "done" : "doing" },
      { text: "Report", state: "todo" },
    ],
    updatedAt: 2,
  };
}

/** The goal replies' test rig: the synthetic Bot API, the replies, the clock and a paced show. */
export interface GoalReplies {
  readonly botApi: FakeBotApi;
  readonly replies: ChatReplies;
  readonly clock: ManualClock;
  readonly show: (given: GoalPushWire) => Promise<void>;
}

/**
 * The owner's chat replies on the synthetic Bot API in a language, with a `show` that waits out
 * the throttler's second between a chat's messages.
 */
export async function setUpGoalReplies(locale: MessageLocale = "en"): Promise<GoalReplies> {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const display = () => ({ locale, timeZone: "UTC" });
  const replies = createChatReplies({ api, owners, clock, logger, display });
  const show = async (given: GoalPushWire): Promise<void> => {
    const shown = replies.show(given, live);
    await clock.advance(1_100);
    await shown;
  };
  return { botApi, replies, clock, show };
}
