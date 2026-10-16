import {
  type AccountRef,
  accountRefSchema,
  type LaunchOption,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/chain";
import {
  createFakeFamily,
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeVenue,
  type FakeLauncher,
  type FakePinScript,
} from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { IntentRequest, IntentView, LaunchTokenRequest } from "@binference/protocol";
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

/** The fake launchpad's id. */
export const testPad = "fake-curve";
/** The test agent's launch wallet and its account. */
export const testLaunchWallet: Id<"wal"> = fixtureId("wal", 270);
/** The launch wallet's account on the fake chain. */
export const testLaunchAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000d9");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const settings: readonly LaunchOption[] = [
  { name: "taxBps", type: "bps", max: 1000, default: 0 },
  { name: "buyback", type: "flag", default: false },
];

/**
 * What a launch's steps do on the fake chain, for a test's simulator: the create call's value
 * leaves the wallet for the launchpad, and the first buy's minimum of the token arrives.
 */
export function testLaunchSimulator(launcher: FakeLauncher): Pick<TxSimulator, "simulate"> {
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

/** How a test launch engine runs: its pins, its options, and whether it has a launch wallet. */
export interface Launching {
  readonly pin?: FakePinScript;
  readonly options?: TestEngineOptions;
  readonly hasLaunchWallet?: boolean;
}

/** A test engine for launches, with the fake launchpad's launcher. */
export interface TestLaunchEngine {
  readonly test: TestEngine;
  readonly launcher: FakeLauncher;
}

/** A live test engine with a fake launchpad, the owner's picture and, by default, a launch wallet. */
export async function testLaunchEngine(launching: Launching = {}): Promise<TestLaunchEngine> {
  const launcher = createFakeLauncher({
    launchOptions: settings,
    ...(launching.pin === undefined ? {} : { pin: launching.pin }),
  });
  const venues = [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launcher })];
  const { options = {}, hasLaunchWallet = true } = launching;
  const test = await startTestEngine({
    chains: testChains([testPad]),
    venues,
    chainSimulator: testLaunchSimulator(launcher),
    launchImages: createMemoryLaunchImages(new Map([["upl_moon", png]])),
    wallets: [testWallet, testLaunchWallet],
    custodyWallets: new Map([[testLaunchWallet, testLaunchAccount]]),
    ...options,
    agent: {
      mode: "live",
      limits: { ...testLimits, venues: ["fake-swap", testPad] },
      ...options.agent,
    },
  });
  if (hasLaunchWallet) {
    test.stores.install.addWallet(
      testWalletRecord({
        id: testLaunchWallet,
        agentId: testAgent,
        label: "launches",
        createdAtMs: testNowMs,
        role: "launch",
      }),
    );
  }
  return { test, launcher };
}

/** A live launch with a first buy, a description, a link and a tax setting. */
export const testLaunch: LaunchTokenRequest = {
  kind: "launchToken",
  agent: testAgent,
  reason: "Launch the cat",
  venue: testPad,
  name: "Moon Cat",
  symbol: "MCAT",
  image: "upl_moon",
  description: "A cat on the moon",
  links: { website: "https://moon.example" },
  pairWith: testCoin,
  firstBuy: { asset: testCoin, base: 1_000_000n },
  venueOptions: { taxBps: 300 },
};

/** Proposes a request and answers its intent; a refusal fails the test. */
export async function proposeIntent(
  test: TestEngine,
  request: IntentRequest = testLaunch,
  caller: EngineCaller = testCallers.runtime,
): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
}

/** A launch's card as an owner reads it, line by line, in one language. */
export async function testCardText(
  test: TestEngine,
  view: IntentView,
  locale: "en" | "zh",
): Promise<readonly string[]> {
  const drawn = await test.engine.handlers["intent/card"](
    testCall({ intent: view.intent }, testCallers.cli),
  );
  if (!drawn.ok) {
    throw new Error(`Expected the card, got ${drawn.error}.`);
  }
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  const display = { formatter, assets: drawn.value.assets };
  return drawn.value.lines.map((line) => cardLineText(line, display));
}

/** The test launch with two links and both its settings set. */
export const testSettledLaunch: LaunchTokenRequest = {
  ...testLaunch,
  links: { website: "https://moon.example", x: "https://x.com/mooncat" },
  venueOptions: { taxBps: 300, buyback: true },
};
