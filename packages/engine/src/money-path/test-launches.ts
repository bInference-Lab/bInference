import {
  type AccountRef,
  accountRefSchema,
  chainRefSchema,
  type LaunchOption,
  type SimulatedStep,
  type TxSimulator,
  type Venue,
} from "@binference/chain";
import {
  createFakeFamily,
  createFakeLauncher,
  createFakeLaunchpad,
  createFakeLinkLauncher,
  createFakePictureLauncher,
  createFakeVenue,
  type FakeLauncher,
  type FakeLauncherOptions,
  type FakePinScript,
} from "@binference/chain/testing";
import type { Id, JsonValue } from "@binference/core";
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
// A PNG whose IHDR chunk tells a 64 by 48 picture: 24 bytes of header, then its chunk's rest.
const sizedPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64,
  0, 0, 0, 48, 8, 6, 0, 0, 0,
]);
const settings: readonly LaunchOption[] = [
  { name: "taxBps", type: "bps", max: 1000, default: 0 },
  { name: "buyback", type: "flag", default: false },
];
const pictureLinkSetting: LaunchOption = { name: "pictureLink", type: "link" };

/**
 * What a launch's steps do on the fake chain, for a test's simulator: the create call's value
 * leaves the wallet for the launchpad, and the first buy's minimum of the token arrives.
 */
export function testLaunchSimulator(
  launcher: Pick<FakeLauncher, "decodeLaunch">,
): Pick<TxSimulator, "simulate"> {
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
  /**
   * The launchpad marks a create call only a launch wallet makes (decision 0271), which the launch
   * wallet's ceiling holds or lacks; it marks none when absent.
   */
  readonly createCall?: { readonly isHeld: boolean };
  /**
   * The launchpad uploads nothing and takes its picture as a `pictureLink` setting, as a launchpad
   * with no API for it (decision 0276); it uploads and pins when absent.
   */
  readonly takesPictureLink?: boolean;
  /**
   * The launchpad writes the picture into its create call, up to these bytes, and the digest it
   * writes when it lies about it (decision 0279); it uploads and pins when absent.
   */
  readonly writesPicture?: { readonly mostBytes: number; readonly sha256?: string };
  /**
   * The launchpad declares an optional amount setting, `sellTaxBps` for its card line, whose value
   * its quote works out as this when a launch leaves it out (decision 0280).
   */
  readonly quotesAmount?: string;
  /**
   * The launchpad declares an outside-only `creatorFeeRecipient` (decision 0277) that its quote
   * works out when a launch leaves it out, or its build always works out (decision 0280), as this.
   */
  readonly worksOutRecipient?: { readonly at: "quote" | "build"; readonly value: string };
  /** The launchpad's own card warnings, by name (decision 0281); none when absent. */
  readonly cardWarnings?: readonly string[];
}

// The create call a test launchpad marks as a launch wallet's alone.
const testCreateAbi: JsonValue = { type: "function", name: "create", inputs: [] };

// The fake launchpad, with a create call only a launch wallet makes when the test asks for one.
function launchpadOf(launcher: PadLauncher, launching: Launching): Venue {
  const pad = createFakeLaunchpad({ onCurve: [], launcher });
  if (launching.createCall === undefined) {
    return pad;
  }
  const calls = [
    { contract: "router", abi: testCreateAbi, walletInputs: [], isLaunchWalletOnly: true },
  ];
  return { ...pad, contracts: pad.contracts.map((item) => Object.assign({}, item, { calls })) };
}

/**
 * A test engine for launches, with the fake launchpad's launcher: the one the launchpad uses, or,
 * for a launchpad that takes its picture as a link, a fake that tells it was never asked to pin.
 */
export interface TestLaunchEngine {
  readonly test: TestEngine;
  readonly launcher: FakeLauncher;
  /** Settles once the launchpad was asked to build. */
  readonly built: Promise<void>;
}

const never = async (): Promise<never> => new Promise<never>(() => undefined);

// The fake launchpad's build as the script says.
function buildOf(script: BuildScript): PadLauncher["buildLaunch"] {
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
function scripted<T extends PadLauncher>(launcher: T, script: BuildScript | undefined) {
  const reached = { resolve: (): void => undefined };
  const asked = new Promise<void>((resolve) => {
    reached.resolve = resolve;
  });
  const build: PadLauncher["buildLaunch"] =
    script === undefined
      ? async (request, call) => launcher.buildLaunch(request, call)
      : buildOf(script);
  const buildLaunch: PadLauncher["buildLaunch"] = async (request, call) => {
    reached.resolve();
    return build(request, call);
  };
  return { launcher: { ...launcher, buildLaunch }, built: asked };
}

/** The launcher a test launchpad uses, which may upload nothing. */
type PadLauncher = Omit<FakeLauncher, "pin" | "pinStatus" | "uploads" | "statusReads">;

// The launcher a launchpad that uploads nothing uses: one that takes a link, or one that writes
// the picture into its create call.
function uploadlessOf(launching: Launching, fakeOptions: FakeLauncherOptions): PadLauncher {
  const { writesPicture } = launching;
  if (writesPicture === undefined) {
    return createFakeLinkLauncher(fakeOptions);
  }
  const lies =
    writesPicture.sha256 === undefined ? {} : { writesPictureSha256: writesPicture.sha256 };
  return createFakePictureLauncher({ ...fakeOptions, ...lies, mostBytes: writesPicture.mostBytes });
}

// The outside-only recipient a test launchpad works out at its quote or its build, if any.
function recipientOf(launching: Launching): {
  readonly options: readonly LaunchOption[];
  readonly fake: Pick<FakeLauncherOptions, "quotesSettings" | "buildsSettings">;
} {
  const worked = launching.worksOutRecipient;
  if (worked === undefined) {
    return { options: [], fake: {} };
  }
  const isQuoted = worked.at === "quote";
  const option: LaunchOption = {
    name: "creatorFeeRecipient",
    type: "account",
    isOutsideOnly: true,
    ...(isQuoted ? { isOptional: true } : { isWorkedOut: true }),
  };
  const values = { creatorFeeRecipient: worked.value };
  return {
    options: [option],
    fake: isQuoted ? { quotesSettings: values } : { buildsSettings: values },
  };
}

// The fake launchers of a test: the uploading fake that counts uploads and pin reads, and the one
// the launchpad uses, which uploads nothing for a launchpad that takes a link or writes the
// picture into its create call.
function launchersOf(launching: Launching) {
  const isLink = launching.takesPictureLink === true;
  const quoted = launching.quotesAmount;
  const optional: readonly LaunchOption[] =
    quoted === undefined ? [] : [{ name: "sellTaxBps", type: "amount", isOptional: true }];
  const fakeOptions = {
    launchOptions: [
      ...settings,
      ...optional,
      ...recipientOf(launching).options,
      ...(isLink ? [pictureLinkSetting] : []),
    ],
    ...(quoted === undefined ? {} : { quotesSettings: { sellTaxBps: quoted } }),
    ...recipientOf(launching).fake,
    ...(launching.pin === undefined ? {} : { pin: launching.pin }),
    ...(launching.noFirstBuyMin === true ? { noFirstBuyMin: true } : {}),
  };
  const counting = scripted(createFakeLauncher(fakeOptions), launching.launcher);
  if (!isLink && launching.writesPicture === undefined) {
    return { ...counting, pad: counting.launcher };
  }
  const used = scripted(uploadlessOf(launching, fakeOptions), launching.launcher);
  return { launcher: counting.launcher, built: used.built, pad: used.launcher };
}

// The launchpad's launcher with its card warnings, when the test names some.
function warnedOf(launcher: PadLauncher, launching: Launching): PadLauncher {
  const { cardWarnings } = launching;
  return cardWarnings === undefined ? launcher : { ...launcher, cardWarnings };
}

/**
 * A live test engine with a fake launchpad, the picture the owner uploaded from the CLI and, by
 * default, a launch wallet.
 */
export async function testLaunchEngine(launching: Launching = {}): Promise<TestLaunchEngine> {
  const { launcher, built, pad } = launchersOf(launching);
  const venues = [createFakeVenue(), launchpadOf(warnedOf(pad, launching), launching)];
  const { options = {}, hasLaunchWallet = true } = launching;
  const test = await startTestEngine({
    chains: testChains([testPad]),
    venues,
    chainSimulator: (launching.simulator ?? ((real) => real))(testLaunchSimulator(pad)),
    launchImages: createMemoryLaunchImages(
      new Map([
        ["upl_moon", png],
        ["upl_sized", sizedPng],
      ]),
      testCallers.cli.credential,
    ),
    wallets: [testWallet, testLaunchWallet],
    unboundFirstBuys: new Map([[chainRefSchema.parse("fake:1"), [testPad]]]),
    custodyWallets: new Map([[testLaunchWallet, testLaunchAccount]]),
    ...options,
    agent: {
      mode: "live",
      limits: { ...testLimits, venues: ["fake-swap", testPad] },
      ...options.agent,
    },
  });
  if (hasLaunchWallet) {
    const record = testWalletRecord({
      id: testLaunchWallet,
      agentId: testAgent,
      label: "launches",
      createdAtMs: testNowMs,
      role: "launch",
    });
    const policy = launching.createCall?.isHeld === true ? [testCreateAbi] : [];
    test.stores.install.addWallet({ ...record, ceiling: { ...record.ceiling, policy } });
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
