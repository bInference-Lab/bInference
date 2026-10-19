import { assetRefSchema } from "@binference/chain";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testNowMs, testWallet } from "../intents/test-intents.js";
import { testCall, testCallers, type TestEngine } from "../operations/test-engine.js";
import { createUploadShelf } from "../uploads/upload-shelf.js";
import {
  proposeIntent as propose,
  testLaunch as launch,
  type Launching,
  testLaunchEngine as engineOver,
  testLaunchWallet as launchWallet,
  testPad as pad,
} from "./test-launches.js";

// The card of an intent that opened one; a test that needs it fails without it.
function cardOf(view: IntentView): NonNullable<IntentView["card"]>["card"] {
  const { card } = view;
  if (card === undefined) {
    throw new Error("The intent opened no card.");
  }
  return card.card;
}

async function stateOf(test: TestEngine, view: IntentView): Promise<IntentView> {
  const read = await test.engine.handlers["intent/get"](
    testCall({ intent: view.intent }, testCallers.cli),
  );
  if (!read.ok) {
    throw new Error(`Expected the intent, got ${read.error}.`);
  }
  return read.value;
}

const signal = { signal: new AbortController().signal };
const cardsOpened = (test: TestEngine) => test.pushes.filter((push) => push.kind === "card/opened");
const notices = (test: TestEngine) =>
  test.pushes.filter((push) => push.kind === "notice/new").map((push) => push.data);

describe("a token launch before its pin", () => {
  it("waits in quoted with its upload made, its card unopened", async () => {
    const { test, launcher } = await engineOver({ pin: { never: true } });
    const view = await propose(test);
    expect(view).toMatchObject({ state: "quoted", wallet: launchWallet });
    expect(launcher.uploads()).toHaveLength(1);
    expect(cardsOpened(test)).toStrictEqual([]);
  });

  it("opens its card once the launchpad reports the pin, never in auto mode", async () => {
    const { test, launcher } = await engineOver({
      pin: { pinnedAfterReads: 2 },
      options: { agent: { approvalMode: "auto" } },
    });
    const view = await propose(test);
    expect(view.state).toBe("quoted");
    await expect(test.engine.checkPins(signal)).resolves.toBe(1);
    const opened = await stateOf(test, view);
    expect(opened).toMatchObject({ state: "awaiting_confirmation" });
    expect(cardsOpened(test)).toHaveLength(1);
    expect(launcher.statusReads()).toBe(2);
  });

  it("goes straight to its card when the pin is reported at once", async () => {
    const { test } = await engineOver();
    await expect(propose(test)).resolves.toMatchObject({ state: "awaiting_confirmation" });
  });

  it("ends with pin_timeout and a notice when no pin comes within 5 minutes", async () => {
    const { test } = await engineOver({ pin: { never: true } });
    const view = await propose(test);
    await test.clock.advance(299_999);
    await test.engine.checkPins(signal);
    expect(await stateOf(test, view)).toMatchObject({ state: "quoted" });
    await test.clock.advance(1);
    await test.engine.checkPins(signal);
    expect(await stateOf(test, view)).toMatchObject({
      state: "failed_check",
      outcome: { reason: "pin_timeout" },
    });
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "pin_timeout" },
      }),
    );
    expect(cardsOpened(test)).toStrictEqual([]);
  });

  it("ends with pin_failed and a notice when the launchpad reports a failed pin", async () => {
    const { test } = await engineOver({ pin: { failsAfterReads: 2 } });
    const view = await propose(test);
    await test.engine.checkPins(signal);
    expect(await stateOf(test, view)).toMatchObject({
      state: "failed_check",
      outcome: { reason: "pin_failed" },
    });
    expect(notices(test)).toContainEqual(expect.objectContaining({ key: "notice.launchStopped" }));
  });
});

// A simulator whose node goes away on the first run, as a stop part way through a launch does.
const failingOnce: NonNullable<Launching["simulator"]> = (real) => {
  const calls = { count: 0 };
  return {
    simulate: async (drafts, call) => {
      calls.count += 1;
      return calls.count === 1
        ? Promise.reject(new Error("The node went away."))
        : real.simulate(drafts, call);
    },
  };
};

describe("a token launch a stop left between its pin and its card", () => {
  it("goes on to its card at the next pin check", async () => {
    const { test } = await engineOver({ simulator: failingOnce });
    await expect(propose(test)).resolves.toMatchObject({ state: "assessed" });
    const left = await test.stores.intents.list({ states: ["assessed"], limit: 5 }, signal);
    expect(left.map((record) => record.kind)).toStrictEqual(["launchToken"]);

    await expect(test.engine.checkPins(signal)).resolves.toBe(1);
    const waiting = { states: ["awaiting_confirmation" as const], limit: 5 };
    const carded = await test.stores.intents.list(waiting, signal);
    expect(carded.map((record) => record.id)).toStrictEqual(left.map((record) => record.id));
  });

  it("is cancelled with a notice once its pin wait and a card's life have passed", async () => {
    const { test } = await engineOver({ simulator: failingOnce });
    const view = await propose(test);
    await test.clock.advance(300_000 + 600_000);
    await expect(test.engine.checkPins(signal)).resolves.toBe(1);
    expect(await stateOf(test, view)).toMatchObject({ state: "cancelled" });
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "engine_stopping" },
      }),
    );
    expect(cardsOpened(test)).toStrictEqual([]);
  });
});

describe("a token launch a fault or a stop cut short once its upload began", () => {
  it("tells the owner when its build fails after the upload", async () => {
    const { test, launcher } = await engineOver({ launcher: { failsBuild: true } });
    const view = await propose(test);
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "venue_down" } });
    expect(launcher.uploads()).toHaveLength(1);
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "venue_down" },
      }),
    );
  });

  it("ends upload_lost with a notice at once when the proposal stops during its build", async () => {
    const stop = new AbortController();
    const { test } = await engineOver({ launcher: { onBuild: "stop", stop } });
    const call = { ...testCall(launch, testCallers.cli), signal: stop.signal };
    await expect(test.engine.handlers["intent/propose"](call)).rejects.toThrow(
      "The engine stopped.",
    );
    const ended = await test.stores.intents.list({ states: ["failed_check"], limit: 5 }, signal);
    expect(ended.map((record) => record.reason)).toStrictEqual(["upload_lost"]);
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "upload_lost" },
      }),
    );
  });

  it("ends upload_lost with a notice at the startup's repair after a crash in its build", async () => {
    const { test, launcher, built } = await engineOver({ launcher: { onBuild: "hang" } });
    void test.engine.handlers["intent/propose"](testCall(launch, testCallers.cli));
    await built;
    expect(launcher.uploads()).toHaveLength(1);
    await expect(test.engine.checkPins(signal)).resolves.toBe(0);

    await expect(test.restart().checkPins({ ...signal, isRepair: true })).resolves.toBe(1);
    const ended = await test.stores.intents.list({ states: ["failed_check"], limit: 5 }, signal);
    expect(ended.map((record) => record.reason)).toStrictEqual(["upload_lost"]);
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "upload_lost" },
      }),
    );
  });
});

describe("a token launch's new token", () => {
  it("ends effects_differ with a notice when the token's address already holds code", async () => {
    const token = assetRefSchema.parse("fake:1/token:0x000000e1");
    const { test } = await engineOver({ options: { tokensWithCode: [token] } });
    const view = await propose(test);
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "effects_differ" } });
    expect(cardsOpened(test)).toStrictEqual([]);
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: pad, reason: "effects_differ" },
      }),
    );
  });
});

describe("a token launch refused before any upload", () => {
  it("is refused in paper mode with nothing read, uploaded or quoted", async () => {
    const { test, launcher } = await engineOver({ options: { agent: { mode: "paper" } } });
    const view = await propose(test);
    expect(view).toMatchObject({ state: "rejected_policy", outcome: { reason: "paper_only" } });
    expect(launcher.uploads()).toStrictEqual([]);
    expect(launcher.statusReads()).toBe(0);
  });

  it("needs the agent's launch wallet: another wallet named, or none made", async () => {
    const named = await engineOver();
    const other = await engineOver({ hasLaunchWallet: false });
    const views = [
      await propose(named.test, { ...launch, wallet: testWallet }),
      await propose(other.test),
    ];
    expect(views.map((view) => [view.state, view.outcome?.reason])).toStrictEqual([
      ["failed_check", "needs_launch_wallet"],
      ["failed_check", "needs_launch_wallet"],
    ]);
    expect([...named.launcher.uploads(), ...other.launcher.uploads()]).toStrictEqual([]);
  });

  it("ends image_unreadable for an upload the engine does not hold", async () => {
    const { test, launcher } = await engineOver();
    const view = await propose(test, { ...launch, image: "upl_gone" });
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "image_unreadable" } });
    expect(launcher.uploads()).toStrictEqual([]);
  });

  it("refuses settings its launchpad does not take, and a venue that launches nothing", async () => {
    const { test } = await engineOver();
    const call = (request: IntentRequest) =>
      test.engine.handlers["intent/propose"](testCall(request, testCallers.cli));
    await expect(call({ ...launch, venueOptions: { taxBps: 5_000 } })).resolves.toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    await expect(call({ ...launch, venue: "fake-swap" })).resolves.toStrictEqual({
      ok: false,
      error: "quote.no_route",
    });
  });
});

describe("who starts a token launch", () => {
  it.each([
    ["the agent runtime", testCallers.runtime],
    ["an MCP client", testCallers.mcp],
  ])("refuses %s before anything is read, stored or uploaded", async (_name, caller) => {
    const { test, launcher } = await engineOver();
    await expect(
      test.engine.handlers["intent/propose"](testCall(launch, caller)),
    ).resolves.toStrictEqual({ ok: false, error: "intent.owner_only" });
    const listed = await test.engine.handlers["intent/list"](
      testCall({ agent: launch.agent }, testCallers.cli),
    );
    expect(listed).toMatchObject({ ok: true, value: { items: [] } });
    expect([launcher.uploads(), launcher.statusReads()]).toStrictEqual([[], 0]);
  });
});

// A PNG as the owner uploads it.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);

// An upload shelf holding the PNG, uploaded with a ticket the credential held.
function shelfWith(holder: string) {
  const shelf = createUploadShelf({
    clock: createManualClock(testNowMs),
    random: createSeededRandom(234),
  });
  const { ticket } = shelf.ticket({ contentType: "image/png", bytes: png.byteLength }, holder);
  return { shelf, upload: expectOk(shelf.receive(ticket, png)) };
}

describe("a token launch's picture", () => {
  it("is read from the owner's upload store, as the server filled it", async () => {
    const { shelf, upload } = shelfWith(testCallers.cli.credential);
    const { test, launcher } = await engineOver({ options: { launchImages: shelf } });

    const view = await propose(test, { ...launch, image: upload });
    expect(view.state).toBe("awaiting_confirmation");
    expect(launcher.uploads().map((made) => made.image.bytes)).toStrictEqual([png]);
  });

  it("must be the proposer's own upload: another credential's ends image_unreadable", async () => {
    const { shelf, upload } = shelfWith("tg:279058397");
    const { test, launcher } = await engineOver({ options: { launchImages: shelf } });

    const view = await propose(test, { ...launch, image: upload });
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "image_unreadable" } });
    expect(launcher.uploads()).toStrictEqual([]);
  });
});

describe("a token launch's card", () => {
  it("is confirmed by the owner's tap and handed to the executor", async () => {
    const { test } = await engineOver();
    const view = await propose(test);
    const card = cardOf(view);
    const confirmed = await test.engine.handlers["intent/confirm"](
      testCall({ intent: view.intent, card, cardVersion: 1 }, testCallers.cli),
    );
    expect(confirmed).toMatchObject({ ok: true, value: { state: "confirmed" } });
    expect(test.executor.taken()).toContain(view.intent);
  });
});
