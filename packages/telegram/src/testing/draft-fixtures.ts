import type { JsonValue } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import type { LaunchDraftShowing } from "@binference/engine/surfaces";
import { createMemoryEngineStores, testAgent } from "@binference/engine/testing";
import { Api } from "grammy";
import {
  createTelegramLaunchDrafts,
  type TelegramLaunchDrafts,
} from "../drafts/create-telegram-launch-drafts.js";
import {
  createFakeLaunchDraftAnswers,
  type FakeLaunchDraftAnswers,
} from "../fakes/fake-launch-draft-answers.js";
import { type ButtonPress, chatUpdateSchema } from "../updates/chat-update.schema.js";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "./fake-bot-api.js";
import type { FakeFileKind } from "./fake-files.js";
import { ownerId } from "./update-fixtures.js";

// The agent's launch drafts in the owner's chat on the synthetic Bot API, for tests.

/** A live call. */
export const live: { readonly signal: AbortSignal } = { signal: new AbortController().signal };
/** The draft's button reference. */
export const draftRef: string = "d3Zr_x9-AbCdEfGh";
const draftId = "c2hvd24tb25jZS1h";

// A draft as the engine shows it, its words the agent's, a control character among them.
const testDraftShowing: LaunchDraftShowing = {
  agent: testAgent,
  agentName: "main",
  ref: draftRef,
  lines: [
    {
      key: "card.launch.description",
      values: { description: { type: "text", text: "A cat‮ <b>on</b> the moon" } },
    },
    {
      key: "card.launch.link",
      values: {
        site: { type: "choice", choice: "website" },
        url: { type: "text", text: "https://moon.example" },
      },
    },
    {
      key: "card.launch.photo",
      values: {
        format: { type: "choice", choice: "png" },
        kib: { type: "count", count: 1 },
        digest: { type: "text", text: "a96735a8ad139cd1" },
      },
    },
  ],
  assets: {},
  expiresAtMs: 1_800_000_600_000,
};

/** A push of the agent's chat topic, as the relay hands it on. */
interface DraftPush {
  readonly kind: string;
  readonly data: JsonValue;
}

/** The push that opens the draft. */
export const openedDraft: DraftPush = {
  kind: "chat/launchDraft",
  data: { agent: testAgent, draft: draftId, expiresAt: 1 },
};

/** The push that ends the draft, with an intent or an error when the outcome carries one. */
export function closedDraft(
  outcome: string,
  extra: Readonly<Record<string, string>> = {},
): DraftPush {
  return {
    kind: "chat/launchDraftClosed",
    data: { agent: testAgent, draft: draftId, outcome, ...extra },
  };
}

/** What a drafts test works with: the synthetic Bot API, the engine's side and the drafts. */
export interface DraftsContext {
  readonly botApi: FakeBotApi;
  readonly answers: FakeLaunchDraftAnswers;
  readonly drafts: TelegramLaunchDrafts;
}

/** The photo a draft names, and what the bot holds it as; none when absent from the bot. */
interface DraftPhoto {
  readonly fileId: string;
  readonly held?: FakeFileKind;
}

/** How a drafts test sets up its draft. */
export interface DraftSetUp {
  /** The photo the draft names; none when the draft has none. */
  readonly photo?: DraftPhoto;
  /** The draft's description in place of the fixture's. */
  readonly description?: string;
}

// The fixture's draft with a test's photo and description.
function showingOf(setUp: DraftSetUp): LaunchDraftShowing {
  const { photo, description } = setUp;
  const lines =
    description === undefined
      ? testDraftShowing.lines
      : [
          {
            key: "card.launch.description",
            values: { description: { type: "text", text: description } },
          } as const,
          ...testDraftShowing.lines.slice(1),
        ];
  const withPhoto = photo === undefined ? {} : { photo: `tg:${photo.fileId}` };
  return { ...testDraftShowing, lines, ...withPhoto };
}

/**
 * The drafts with the owner paired, one open draft, and the synthetic Bot API; with a photo, the
 * draft names that photo, which the bot holds as `held`.
 */
export async function setUpDrafts(
  locale: "en" | "zh" = "en",
  setUp: DraftSetUp = {},
): Promise<DraftsContext> {
  const { photo } = setUp;
  const botApi = createFakeBotApi();
  if (photo?.held !== undefined) {
    botApi.addFile(photo.fileId, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
      kind: photo.held,
    });
  }
  const showing = showingOf(setUp);
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const stores = createMemoryEngineStores();
  await stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const answers = createFakeLaunchDraftAnswers({ ownerId });
  answers.open(draftRef);
  const drafts = createTelegramLaunchDrafts({
    api,
    owners: stores.owners,
    drafts: { showing: (id) => (id === draftId ? showing : undefined) },
    answers,
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: () => ({ locale, timeZone: "UTC" }),
  });
  return { botApi, answers, drafts };
}

/** A press of a draft's button, as the bot receives it. */
export function pressOf(context: DraftsContext, data: string, from: number = ownerId): ButtonPress {
  const parsed = chatUpdateSchema.parse(context.botApi.press({ from, data, messageId: 1001 }));
  if (parsed.kind !== "callback") {
    throw new Error("The fixture is no button press.");
  }
  return parsed;
}
