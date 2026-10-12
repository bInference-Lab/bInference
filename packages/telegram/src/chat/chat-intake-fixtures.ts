import { type Id, idSchema, ok } from "@binference/core";
import { createManualClock, createMemoryLogger, type ManualClock } from "@binference/core/testing";
import { createOwnerCalls } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import type { ArgsOf, ResultOf } from "@binference/protocol";
import { Api } from "grammy";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, photoUpdate, textUpdate } from "../testing/update-fixtures.js";
import { type ChatPost, chatUpdateSchema } from "../updates/chat-update.schema.js";
import { type ChatIntake, createChatIntake } from "./chat-intake.js";

/** The only agent of the intake's tests. */
export const agent: Id<"agt"> = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab");

const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.10.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: agent, mode: "paper", frozen: false }],
  health: [],
};

const posted: ResultOf<"chat/post"> = {
  session: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab"),
  turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab"),
};

/** Reads a post as the ingress hands it on. */
export function postOf(update: Parameters<typeof chatUpdateSchema.parse>[0]): ChatPost {
  const parsed = chatUpdateSchema.parse(update);
  if (parsed.kind !== "message" && parsed.kind !== "edit") {
    throw new Error("The fixture is not a chat post.");
  }
  return parsed;
}

/** A text the owner sent. */
export function ownerText(updateId: number, text: string): ChatPost {
  return postOf(textUpdate({ updateId, from: ownerId, text }));
}

/** A photo the owner sent, one of an album when it names one. */
export function ownerPhoto(
  updateId: number,
  photo: { readonly sizeBytes?: number; readonly caption?: string; readonly albumId?: string },
): ChatPost {
  return postOf(
    photoUpdate({ updateId, from: ownerId, fileId: `photo${String(updateId)}`, ...photo }),
  );
}

/** The args of the `chat/post` calls the engine took. */
type PostArgs = ArgsOf<"chat/post">;

/** The owner's chat intake on the fake Bot API, and what a test reads. */
export interface IntakeRig {
  readonly botApi: FakeBotApi;
  readonly clock: ManualClock;
  readonly intake: ChatIntake;
  /** What the engine took as `chat/post`, in order. */
  readonly posts: readonly PostArgs[];
  /** The texts the bot sent to the owner, in order. */
  readonly texts: () => readonly string[];
}

/** Starts the owner's chat intake on the fake Bot API, for the only agent {@link agent}. */
export function startIntake(locale: MessageLocale = "en"): IntakeRig {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const posts: PostArgs[] = [];
  const calls = createOwnerCalls({
    handlers: {
      "engine/status": async () => Promise.resolve(ok(status)),
      "chat/post": async (call) => {
        posts.push(call.args);
        return Promise.resolve(ok(posted));
      },
    },
    ownerId: async () => Promise.resolve(ownerId),
  });
  const display = () => ({ locale, timeZone: "UTC" });
  const intake = createChatIntake({ api, calls, clock, logger, display });
  return { botApi, clock, intake, posts, texts: () => botApi.sent().map(({ text }) => text) };
}
