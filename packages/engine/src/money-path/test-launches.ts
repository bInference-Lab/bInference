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
          // A create call that carries no minimum gets what the fake launchpad quotes.
          const base = bought?.minOut === 0n ? bought.spend.base * 1_000n : bought?.minOut;
          const got =
            bought === undefined || base === undefined
              ? []
              : [{ from: to, to: draft.from, amount: { asset: token, base } }];
          return { status: "success", gasUsed: 21_000n, transfers: [paid, ...got], approvals: [] };
        }),
      );
    },
  };
}

/**
 * How the fake launchpad's build goes, when not as the fake builds it: it throws; it stops the
 * proposal, as an engine stop does, and never answers; or it never answers, as in a crash.
 */
type BuildScript =
  | { readonly failsBuild: true }
  | { readonly onBuild: "stop"; readonly stop: AbortController }
  | { readonly onBuild: "hang" };

/** How a test launch engine runs: its pins, its options, and whether it has a launch wallet. */
export interface Launching {
  readonly pin?: FakePinScript;
  readonly launcher?: BuildScript;
  /** Wraps the simulator a launch's steps run on. */
  readonly simulator?: (real: Pick<TxSimulator, "simulate">) => Pick<TxSimulator, "simulate">;
  readonly options?: TestEngineOptions;
  readonly hasLaunchWallet?: boolean;
  /** The launchpad's create call carries no first-buy minimum, as it declares (decision 0270). */
  readonly noFirstBuyMin?: boolean;
}

/** A test engine for launches, with the fake launchpad's launcher. */
export interface TestLaunchEngine {
  readonly test: TestEngine;
  readonly launcher: FakeLauncher;
  /** Settles once the launchpad was asked to build. */
  readonly built: Promise<void>;
}

const never = async (): Promise<never> => new Promise<never>(() => undefined);

// The fake launchpad's build as the script says.
function buildOf(script: BuildScript): FakeLauncher["buildLaunch"] {
  if ("failsBuild" in script) {
    return async () => Promise.reject(new Error("The launchpad is down."));
  }
  if (script.onBuild === "hang") {
    return never;
  }
  return async () => {
    script.stop.abort(new Error("The engine stopped."));
    return never();
  };
}

// The fake launcher with its build as the script says, and a promise that settles once it is asked.
function scripted(launcher: FakeLauncher, script: BuildScript | undefined) {
  const reached = { resolve: (): void => undefined };
  const asked = new Promise<void>((resolve) => {
    reached.resolve = resolve;
  });
  const build: FakeLauncher["buildLaunch"] =
    script === undefined
      ? async (request, call) => launcher.buildLaunch(request, call)
      : buildOf(script);
  const buildLaunch: FakeLauncher["buildLaunch"] = async (request, call) => {
    reached.resolve();
    return build(request, call);
  };
  return { launcher: { ...launcher, buildLaunch }, built: asked };
}

/**
 * A live test engine with a fake launchpad, the picture the owner uploaded from the CLI and, by
 * default, a launch wallet.
 */
export async function testLaunchEngine(launching: Launching = {}): Promise<TestLaunchEngine> {
  const { launcher, built } = scripted(
    createFakeLauncher({
      launchOptions: settings,
      ...(launching.pin === undefined ? {} : { pin: launching.pin }),
      ...(launching.noFirstBuyMin === true ? { noFirstBuyMin: true } : {}),
    }),
    launching.launcher,
  );
  const venues = [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launcher })];
  const { options = {}, hasLaunchWallet = true } = launching;
  const test = await startTestEngine({
    chains: testChains([testPad]),
    venues,
    chainSimulator: (launching.simulator ?? ((real) => real))(testLaunchSimulator(launcher)),
    launchImages: createMemoryLaunchImages(
      new Map([["upl_moon", png]]),
      testCallers.cli.credential,
    ),
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
  return { test, launcher, built };
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

/**
 * Proposes a request, by default as the owner on the CLI, who uploaded the test picture, and
 * answers its intent; a refusal fails the test.
 */
export async function proposeIntent(
  test: TestEngine,
  request: IntentRequest = testLaunch,
  caller: EngineCaller = testCallers.cli,
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
