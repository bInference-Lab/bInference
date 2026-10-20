import { type Id, idSchema, type JsonValue, type Result } from "@binference/core";
import { createSeededRandom, createManualClock } from "@binference/core/testing";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { ArgsOf, LaunchTerms, ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { AgentInboxDraft } from "../chat/agent-inbox-record.js";
import { createMemoryOwnerImages } from "../fakes/memory-owner-images.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import {
  type Launching,
  testLaunch,
  testLaunchEngine,
  type TestLaunchEngine,
} from "../money-path/test-launches.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { type TestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { createUploadShelf, type UploadShelf } from "../uploads/upload-shelf.js";

// Launch drafts (decisions 0285 and 0286) on the fake launchpad: the runtime's turn, the owner's
// photo in a stored Telegram message, and the upload shelf the launch from a draft reads.

/** The owner's numeric Telegram id. */
export const draftOwnerId = 7_012_345_678;
/** The runtime's running turn the drafts come from. */
const draftSession: Id<"ses"> = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000285");
const draftTurn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000285");
/** The owner's Telegram message with the photo. */
export const photoMessage: Id<"msg"> = idSchema("msg").parse(
  "msg_0190f1c2-3a4b-7c5d-8e6f-000000000285",
);
/** The photo's name in that message. */
export const photoName: string = "tg:AgACAgIAAxkBAAIBcat";
/** A PNG whose IHDR chunk tells a 64 by 48 picture. */
export const photoPng: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64,
  0, 0, 0, 48, 8, 6, 0, 0, 0,
]);

/** The test launch's terms, as the agent drafts them. */
export const draftTerms: LaunchTerms = {
  reason: testLaunch.reason,
  venue: testLaunch.venue,
  name: testLaunch.name,
  symbol: testLaunch.symbol,
  description: "A cat on the moon",
  links: { website: "https://moon.example" },
  pairWith: testLaunch.pairWith,
  firstBuy: { asset: testLaunch.pairWith, base: 1_000_000n },
  venueOptions: { taxBps: 300 },
};

/** A draft test engine: the launch engine, its fake launcher and the owner's upload shelf. */
export interface DraftEngine extends TestLaunchEngine {
  readonly uploads: UploadShelf;
}

/** The owner's message in the agent's inbox: from Telegram by default, naming the photo. */
export async function storeOwnerMessage(
  test: TestEngine,
  payload: { readonly images: readonly string[]; readonly surface?: string },
): Promise<void> {
  const signal = AbortSignal.timeout(5_000);
  const surface = payload.surface ?? "telegram";
  const message = { text: "Launch this cat", images: [...payload.images], surface };
  const draft: AgentInboxDraft = {
    id: photoMessage,
    agentId: testAgent,
    kind: "inbox/message",
    payload: message,
    atMs: test.clock.now(),
    opens: draftSession,
  };
  const added = await test.stores.agentInbox.add(draft, { signal });
  if (!added.ok) {
    throw new Error(`Expected the message stored, got ${added.error}.`);
  }
}

/**
 * A live launch engine with the runtime's turn running, the owner's photo message stored unless
 * `isStored` is false, the bot holding the photo, and one upload shelf for drafts and launches.
 */
export async function testDraftEngine(
  launching: Launching = {},
  setup: { readonly isStored?: boolean } = {},
): Promise<DraftEngine> {
  const uploads = createUploadShelf({
    clock: createManualClock(testNowMs),
    random: createSeededRandom(285),
  });
  const botImages = createMemoryOwnerImages(new Map([[photoName, photoPng]]));
  const options = { uploads, launchImages: uploads, botImages, ...launching.options };
  const launch = await testLaunchEngine({ ...launching, options });
  const start = {
    agent: testAgent,
    session: draftSession,
    turn: draftTurn,
    messages: [],
    outsideContent: false,
  };
  const started = await launch.test.engine.handlers["turn/start"](
    testCall(start, testCallers.runtime),
  );
  if (!started.ok) {
    throw new Error(`Expected the turn started, got ${started.error}.`);
  }
  if (setup.isStored !== false) {
    await storeOwnerMessage(launch.test, { images: [photoName] });
  }
  return { ...launch, uploads };
}

/** The args of a draft in the running turn, with the owner's photo unless the test says so. */
export function draftArgs(overrides: Partial<ArgsOf<"launch/draft">> = {}): ArgsOf<"launch/draft"> {
  return {
    agent: testAgent,
    session: draftSession,
    turn: draftTurn,
    launch: draftTerms,
    photo: { message: photoMessage, image: photoName },
    ...overrides,
  };
}

/** The args of a draft in the running turn with no photo, as for a launchpad that takes a link. */
export function draftArgsWithoutPhoto(
  overrides: Partial<ArgsOf<"launch/draft">> = {},
): ArgsOf<"launch/draft"> {
  const { photo: _photo, ...args } = draftArgs(overrides);
  return args;
}

/** Drafts a launch, by default as the runtime in its running turn. */
export async function draftOf(
  test: TestEngine,
  args: ArgsOf<"launch/draft"> = draftArgs(),
  caller: EngineCaller = testCallers.runtime,
): Promise<Result<ResultOf<"launch/draft">, ProtocolErrorCode>> {
  return test.engine.handlers["launch/draft"](testCall(args, caller));
}

/** A draft's lines as the owner reads them, in one language. */
export function draftText(test: TestEngine, draft: string, locale: "en" | "zh"): readonly string[] {
  const showing = test.engine.launchDrafts.showing(draft);
  if (showing === undefined) {
    return [];
  }
  const display = {
    formatter: createFormatter({ locale, timeZone: "UTC" }),
    assets: showing.assets,
  };
  return showing.lines.map((line) => cardLineText(line, display));
}

/** The reference the buttons of an open draft carry; a draft that ended fails the test. */
export function refOf(test: TestEngine, draft: string): string {
  const showing = test.engine.launchDrafts.showing(draft);
  if (showing === undefined) {
    throw new Error("Expected the draft open.");
  }
  return showing.ref;
}

/** The pushes of the agent's chat topic of one kind. */
export function chatPushes(test: TestEngine, kind: string): readonly JsonValue[] {
  return test.pushes
    .filter((push) => push.topic === `chat:${testAgent}` && push.kind === kind)
    .map((push) => push.data);
}
