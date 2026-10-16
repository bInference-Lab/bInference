import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testWallet } from "../intents/test-intents.js";
import { testCall, testCallers, type TestEngine } from "../operations/test-engine.js";
import {
  proposeIntent as propose,
  testLaunch as launch,
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
      test.engine.handlers["intent/propose"](testCall(request, testCallers.runtime));
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
