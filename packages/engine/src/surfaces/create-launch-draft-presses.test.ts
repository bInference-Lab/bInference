import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { expectOk, testAgent, testLimits } from "../intents/test-intents.js";
import { launchDraftOpenMs } from "../launches/launch-draft-shelf.js";
import {
  chatPushes,
  type DraftEngine,
  draftArgs,
  draftArgsWithoutPhoto,
  draftOf,
  draftOwnerId,
  draftTerms,
  photoPng,
  refOf,
  testDraftEngine,
} from "../launches/test-launch-drafts.js";
import { testCardText, testPad } from "../money-path/test-launches.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createLaunchDraftPresses } from "./create-launch-draft-presses.js";

const signal = (): AbortSignal => AbortSignal.timeout(5_000);

// The presses as the owner's bot hands them to the engine, for the paired owner.
function pressesOf(drafting: DraftEngine) {
  return createLaunchDraftPresses({ desk: drafting.test.engine.launchDrafts });
}

async function drafted(launching: Parameters<typeof testDraftEngine>[0] = {}) {
  const drafting = await testDraftEngine(launching);
  const { draft } = expectOk(await draftOf(drafting.test));
  const ref = refOf(drafting.test, draft);
  return { drafting, draft, ref, presses: pressesOf(drafting) };
}

const start = (ref: string, presserId = draftOwnerId) => ({ ref, start: true, presserId });
const drop = (ref: string, presserId = draftOwnerId) => ({ ref, start: false, presserId });

// The owner's Start, answered at once, and its launch once the background proposal ended: the
// draft's closing push, and the intent it names when it started; any other end fails the test.
async function startedIntent(drafting: DraftEngine, ref: string): Promise<Id<"int">> {
  const closed = await settledStart(drafting, ref);
  const intent =
    closed.outcome === "started" ? idSchema("int").safeParse(closed.intent) : undefined;
  if (intent?.success !== true) {
    throw new Error(`Expected a start, got ${JSON.stringify(closed)}.`);
  }
  return intent.data;
}

// Presses Start, which answers `starting` at once, and answers the draft's closing push once the
// background proposal ended.
async function settledStart(drafting: DraftEngine, ref: string) {
  const standing = await pressesOf(drafting).answer(start(ref), { signal: signal() });
  if (standing.status !== "starting") {
    throw new Error(`Expected starting, got ${standing.status}.`);
  }
  await drafting.test.engine.launchDrafts.idle();
  return closedSchema.parse(chatPushes(drafting.test, "chat/launchDraftClosed").at(-1));
}

const closedSchema = z.looseObject({
  outcome: z.string(),
  intent: z.string().optional(),
  error: z.string().optional(),
  reason: z.string().optional(),
});

const outsideWarning =
  "\u26a0\ufe0f This came after reading outside content (web, X, token data or an image)";

// A launch the owner started from a draft of a turn marked outside content or not, its stored
// intent and its card as the owner reads it.
async function startedFrom(turn: { readonly isMarked: boolean }) {
  const drafting = await testDraftEngine();
  if (turn.isMarked) {
    const { agent, turn: id } = draftArgs();
    expectOk(
      await drafting.test.engine.handlers["turn/mark"](
        testCall({ agent, turn: id }, testCallers.runtime),
      ),
    );
  }
  const { draft } = expectOk(await draftOf(drafting.test));
  const ref = refOf(drafting.test, draft);
  const intent = await startedIntent(drafting, ref);
  const stored = await drafting.test.stores.intents.get(intent, { signal: signal() });
  const view = expectOk(
    await drafting.test.engine.handlers["intent/get"](testCall({ intent }, testCallers.cli)),
  );
  return { stored, card: await testCardText(drafting.test, view, "en") };
}

describe("the owner's presses of a launch draft", () => {
  it("starts the launch as the owner on Telegram, with the photo the draft showed", async () => {
    const { drafting, draft, ref } = await drafted();
    const intent = await startedIntent(drafting, ref);
    const view = expectOk(
      await drafting.test.engine.handlers["intent/get"](
        testCall({ intent: intent }, testCallers.cli),
      ),
    );
    expect(view.request).toMatchObject({ ...draftTerms, kind: "launchToken", agent: testAgent });
    expect(view.state).toBe("awaiting_confirmation");
    const stored = await drafting.test.stores.intents.get(intent, { signal: signal() });
    expect([stored?.proposer, stored?.hasOutsideContent]).toStrictEqual(["telegram", false]);
    expect(drafting.launcher.uploads().map(({ image }) => image.bytes)).toStrictEqual([photoPng]);
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toStrictEqual([
      { agent: testAgent, draft, outcome: "started", intent },
    ]);
  });

  it("starts a draft once: a second press of its reference proposes nothing", async () => {
    const { drafting, ref, presses } = await drafted();
    const first = await presses.answer(start(ref), { signal: signal() });
    const second = await presses.answer(start(ref), { signal: signal() });
    await drafting.test.engine.launchDrafts.idle();
    const listed = expectOk(
      await drafting.test.engine.handlers["intent/list"](
        testCall({ agent: testAgent }, testCallers.cli),
      ),
    );
    expect([first.status, second.status, listed.items.length]).toStrictEqual([
      "starting",
      "unknown",
      1,
    ]);
  });

  it("does nothing for a press of anyone but the owner, or of a reference no draft has", async () => {
    const { drafting, draft, ref, presses } = await drafted();
    const answers = await Promise.all([
      presses.answer(start(ref, 7_000_000_001), { signal: signal() }),
      presses.answer(drop(ref, 7_000_000_001), { signal: signal() }),
      presses.answer(start("ZZZZZZZZZZZZZZZZ"), { signal: signal() }),
    ]);
    expect(answers.map(({ status }) => status)).toStrictEqual(["unknown", "unknown", "unknown"]);
    expect(drafting.test.engine.launchDrafts.showing(draft)?.ref).toBe(ref);
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toStrictEqual([]);
  });

  it("drops a draft on Drop, after which Start proposes nothing", async () => {
    const { drafting, draft, ref, presses } = await drafted();
    const dropped = await presses.answer(drop(ref), { signal: signal() });
    const started = await presses.answer(start(ref), { signal: signal() });
    expect([dropped.status, started.status]).toStrictEqual(["dropped", "unknown"]);
    expect(drafting.launcher.uploads()).toStrictEqual([]);
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toStrictEqual([
      { agent: testAgent, draft, outcome: "dropped" },
    ]);
  });

  it("starts nothing once the draft's 10 minutes ran out, and the card timer ends it", async () => {
    const late = await drafted();
    await late.drafting.test.clock.advance(launchDraftOpenMs);
    const pressed = await late.presses.answer(start(late.ref), { signal: signal() });
    const timed = await drafted();
    const due = await timed.drafting.test.engine.expireCards({ signal: signal() });
    await timed.drafting.test.clock.advance(launchDraftOpenMs);
    const after = await timed.drafting.test.engine.expireCards({ signal: signal() });
    expect([pressed.status, due, after]).toStrictEqual([
      "expired",
      timed.drafting.test.clock.now(),
      undefined,
    ]);
    expect(chatPushes(timed.drafting.test, "chat/launchDraftClosed")).toStrictEqual([
      { agent: testAgent, draft: timed.draft, outcome: "expired" },
    ]);
  });

  it("starts a launch on a picture link with no upload", async () => {
    const drafting = await testDraftEngine({ takesPictureLink: true });
    const launch = {
      ...draftTerms,
      venueOptions: { taxBps: 300, pictureLink: "https://cat.example/cat.png" },
    };
    const { draft } = expectOk(await draftOf(drafting.test, draftArgsWithoutPhoto({ launch })));
    const ref = refOf(drafting.test, draft);
    expect((await settledStart(drafting, ref)).outcome).toBe("started");
    expect(drafting.launcher.uploads()).toStrictEqual([]);
  });

  it("tells the owner when the launch from a draft is refused", async () => {
    const { drafting, draft, ref } = await drafted({ pin: { never: true } });
    const plan = { contentType: "image/png", bytes: photoPng.byteLength } as const;
    const { ticket } = drafting.uploads.ticket(plan, testCallers.cli.credential);
    const image = expectOk(drafting.uploads.receive(ticket, photoPng));
    const launch = { ...draftTerms, kind: "launchToken", agent: testAgent, image } as const;
    expectOk(
      await drafting.test.engine.handlers["intent/propose"](testCall(launch, testCallers.cli)),
    );
    await settledStart(drafting, ref);
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toStrictEqual([
      { agent: testAgent, draft, outcome: "failed", error: "intent.launch_waiting" },
    ]);
  });

  it("keeps the agent's and MCP clients' own launch proposals refused as the owner's alone", async () => {
    const { drafting } = await drafted();
    const launch = {
      ...draftTerms,
      kind: "launchToken",
      agent: testAgent,
      image: "upl_moon",
    } as const;
    const answers = await Promise.all(
      [testCallers.runtime, testCallers.mcp].map(async (caller) =>
        drafting.test.engine.handlers["intent/propose"](testCall(launch, caller)),
      ),
    );
    expect(answers).toStrictEqual([
      { ok: false, error: "intent.owner_only" },
      { ok: false, error: "intent.owner_only" },
    ]);
  });

  it("carries the drafting turn's outside-content mark to the launch's card, and only that", async () => {
    const clean = await startedFrom({ isMarked: false });
    const marked = await startedFrom({ isMarked: true });
    expect([clean.stored?.hasOutsideContent, marked.stored?.hasOutsideContent]).toStrictEqual([
      false,
      true,
    ]);
    expect(clean.card).not.toContain(outsideWarning);
    expect(marked.card).toContain(outsideWarning);
  });

  it("opens a card for a launch from a draft even in auto mode", async () => {
    const { drafting, ref } = await drafted({
      options: { agent: { approvalMode: "auto" } },
    });
    const intent = await startedIntent(drafting, ref);
    const view = expectOk(
      await drafting.test.engine.handlers["intent/get"](testCall({ intent }, testCallers.cli)),
    );
    expect(view.state).toBe("awaiting_confirmation");
  });

  it("says why when the launch ended before its card, never that it started", async () => {
    const limits = { ...testLimits, venues: ["fake-swap", testPad], perTradeUsdMicros: 1n };
    const { drafting, draft, ref } = await drafted({ options: { agent: { limits } } });
    await settledStart(drafting, ref);
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toMatchObject([
      { agent: testAgent, draft, outcome: "failed", reason: "per_trade_cap" },
    ]);
    expect(drafting.launcher.uploads()).toStrictEqual([]);
  });

  it("answers Start at once and leaves the engine free while the launch is proposed", async () => {
    const { drafting, ref, presses } = await drafted({ launcher: { onBuild: "hang" } });
    const standing = await presses.answer(start(ref), { signal: signal() });
    const cli = testCallers.cli;
    const frozen = await drafting.test.engine.handlers["safety/freeze"](
      testCall({ agent: testAgent }, cli),
    );
    expect([standing.status, frozen.ok]).toStrictEqual(["starting", true]);
    await drafting.test.engine.launchDrafts.close();
    expect(chatPushes(drafting.test, "chat/launchDraftClosed")).toHaveLength(1);
  });
});
