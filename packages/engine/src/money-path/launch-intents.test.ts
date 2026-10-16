import {
  accountRefSchema,
  type LaunchOption,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/chain";
import {
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeVenue,
  type FakeLauncher,
  type FakePinScript,
  createFakeFamily,
} from "@binference/chain/testing";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryLaunchImages } from "../fakes/memory-launch-images.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testCoin, testLimits, testNowMs, testWallet } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";

// Token launches (decision 0234) on a fake launchpad whose launcher pins as each test scripts.
const pad = "fake-curve";
const launchWallet = fixtureId("wal", 270);
const launchAccount = accountRefSchema.parse("fake:1:0x000000d9");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const settings: readonly LaunchOption[] = [
  { name: "taxBps", type: "bps", max: 1000, default: 0 },
  { name: "buyback", type: "flag", default: false },
];

// What a launch's steps do on the fake chain: the create call's value leaves the wallet for the
// launchpad, and the first buy's minimum of the token arrives.
function launchSimulator(launcher: FakeLauncher): TxSimulator {
  const family = createFakeFamily();
  const reverted: SimulatedStep = { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };
  return {
    async simulate(drafts, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(
        drafts.map((draft): SimulatedStep => {
          const call = family.readDraft(draft);
          const launch = launcher.decodeLaunch(draft);
          if (!call.ok || !launch.ok) {
            return reverted;
          }
          const to = call.value.target;
          const paid = {
            from: draft.from,
            to,
            amount: { asset: testCoin, base: call.value.nativeValue },
          };
          const bought = launch.value.firstBuy;
          const token = launch.value.token;
          const got =
            bought === undefined
              ? []
              : [{ from: to, to: draft.from, amount: { asset: token, base: bought.minOut } }];
          return { status: "success", gasUsed: 21_000n, transfers: [paid, ...got], approvals: [] };
        }),
      );
    },
  };
}

// The card of an intent that opened one; a test that needs it fails without it.
function cardOf(view: IntentView): NonNullable<IntentView["card"]>["card"] {
  const { card } = view;
  if (card === undefined) {
    throw new Error("The intent opened no card.");
  }
  return card.card;
}

interface Launching {
  readonly pin?: FakePinScript;
  readonly options?: TestEngineOptions;
  readonly hasLaunchWallet?: boolean;
}

async function engineOver(launching: Launching = {}) {
  const launcher = createFakeLauncher({
    launchOptions: settings,
    ...(launching.pin === undefined ? {} : { pin: launching.pin }),
  });
  const venues = [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launcher })];
  const { options = {}, hasLaunchWallet = true } = launching;
  const test = await startTestEngine({
    chains: testChains([pad]),
    venues,
    chainSimulator: launchSimulator(launcher),
    launchImages: createMemoryLaunchImages(new Map([["upl_moon", png]])),
    wallets: [testWallet, launchWallet],
    custodyWallets: new Map([[launchWallet, launchAccount]]),
    ...options,
    agent: {
      mode: "live",
      limits: { ...testLimits, venues: ["fake-swap", pad] },
      ...options.agent,
    },
  });
  if (hasLaunchWallet) {
    test.stores.install.addWallet(
      testWalletRecord({
        id: launchWallet,
        agentId: testAgent,
        label: "launches",
        createdAtMs: testNowMs,
        role: "launch",
      }),
    );
  }
  return { test, launcher };
}

const launch: Extract<IntentRequest, { kind: "launchToken" }> = {
  kind: "launchToken",
  agent: testAgent,
  reason: "Launch the cat",
  venue: pad,
  name: "Moon Cat",
  symbol: "MCAT",
  image: "upl_moon",
  description: "A cat on the moon",
  links: { website: "https://moon.example" },
  pairWith: testCoin,
  firstBuy: { asset: testCoin, base: 1_000_000n },
  venueOptions: { taxBps: 300 },
};

async function propose(
  test: TestEngine,
  request: IntentRequest = launch,
  caller: EngineCaller = testCallers.runtime,
): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
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
