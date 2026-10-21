import { setTimeout as wait } from "node:timers/promises";
import { intentStates } from "@binference/engine";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { SourceProgram } from "../e2e/source-program.js";
import type { RelayedSend } from "./crash-chain.js";
import type { ChainRequest } from "./crash-chain.schema.js";
import type { CrashContext } from "./crash-context.js";
import { launchTokensPerUnit } from "./crash-flap.js";
import {
  armKillWith,
  killWhenReached,
  restartWith,
  type RunKillPoint,
  storyOf,
  useCrashHarness,
} from "./crash-harness.js";
import { type StoredLaunchRun, storedLaunchOf } from "./crash-launch-reads.js";
import { type CrashLaunchPair, crashFirstBuys } from "./crash-launch-terms.js";
import {
  cardOpenOf,
  type CrashLauncher,
  launchAndTap,
  type SettledLaunch,
  settleLaunchAndStop,
  setUpLauncher,
} from "./crash-launches.js";
import { type AtKill, atKillOf, landedOf, minedOf, unminedOf, withStore } from "./crash-reads.js";
import { type CrashInstall, setUpCrashInstall } from "./crash-runs.js";

// Each run launches a token on the crash chain's Flap as the owner does from the CLI: the launch
// wallet made and funded, the picture uploaded, the launch proposed, its card confirmed once the
// launchpad pinned its words. The test kills the engine outright at the run's point, from Flap's
// upload to the create call's receipt, and a second engine on the same folder recovers; the owner
// confirms a card it opens. What reached the chain is counted by the test's relays and anvil, the
// signatures by the test's Privy, the uploads by the test's Flap API, never taken from the engine.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 37 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const pins = ["processing", "pinned"] as const;
const cid = "bafkreicrashcatlaunchedthroughaforcedstopbyabinferencecrashrun";

/**
 * Where a launch run kills the engine: as Flap's API gets the upload (`upload`) or the first pin
 * read (`pin`), as the engine reads the new token's code once the pin is in (`pinned`), once the
 * card is open (`card`), or at a point of the money path on the step the run names.
 */
type LaunchKillPoint = "upload" | "pin" | "pinned" | "card" | RunKillPoint;

/** What a run at one kill point of a launch does and must show. */
interface LaunchKillCase {
  readonly pair: CrashLaunchPair;
  readonly point: LaunchKillPoint;
  /** The step the kill waits for: a token pair's approval (0) or its create call (1). */
  readonly step: 0 | 1;
  /** The launch's state when the engine died. */
  readonly stateAtKill: string;
  readonly atKill: AtKill;
  /** Where the restarted engine ended the launch. */
  readonly end: "reconciled" | "failed_check" | "cancelled" | "failed_onchain";
  /** The distinct transactions that reach the chain: none, the approval, or every step. */
  readonly sent: 0 | 1 | 2;
  readonly isResent: boolean;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  /** Whether the owner confirms a card the restarted engine opened. */
  readonly isTappedAfter: boolean;
  /** The owner's notices about the launch. */
  readonly notices: readonly string[];
}

/** What reached the chain, custody and Flap from one launch run, and what the store holds. */
interface LaunchOutcome {
  readonly stateAtKill: string | undefined;
  readonly atKill: AtKill;
  readonly sends: readonly RelayedSend[];
  readonly isResent: boolean;
  readonly mined: number;
  readonly unmined: number;
  readonly landed: readonly string[];
  readonly uploads: number;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  readonly restartExit: number | undefined;
  readonly settled: SettledLaunch;
  readonly stored: StoredLaunchRun;
  readonly story: string;
}

// The launch's state in the store the moment the engine died.
async function stateOf(install: CrashInstall): Promise<string | undefined> {
  return withStore(install.machine.folder, async ({ intents }, signal) => {
    const all = await intents.list({ states: [...intentStates], limit: 10 }, { signal });
    return all.find((intent) => intent.kind === "launchToken")?.state;
  });
}

// The engine's read of the code at the new token's address, a Flap tax token's ending in 7777,
// which it makes once the pin is in and before the simulation.
function isNewTokenRead(request: ChainRequest): boolean {
  return request.method === "eth_getCode" && JSON.stringify(request.params[0]).endsWith(`7777"`);
}

// Waits until the store holds the step's transaction in a block, as the engine read its receipt.
async function untilIncluded(install: CrashInstall, launcher: CrashLauncher): Promise<void> {
  const { chain } = harness.worldOf();
  const atKill = await atKillOf(chain, launcher.address, install.machine.folder);
  if (atKill.stored.at(-1) === "included") {
    return;
  }
  await wait(100);
  return untilIncluded(install, launcher);
}

/** One run's install, launcher and kill case. */
interface LaunchRun {
  readonly install: CrashInstall;
  readonly launcher: CrashLauncher;
  readonly killCase: LaunchKillCase;
}

// Kills the engine once it got to the run's point. A kill on the create call of a token pair's
// launch waits for its approval's send first; one after the receipt waits until it is stored.
async function armed(first: SourceProgram, run: LaunchRun): Promise<void> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const { install, launcher, killCase } = run;
  const { point, step } = killCase;
  return armKillWith(first, point, async (kill) => {
    if (point === "upload" || point === "pin" || point === "pinned" || point === "card") {
      const reached = {
        upload: async () => services.flap.holdNextUpload(),
        pin: async () => services.flap.holdNextPinRead(),
        pinned: async () => chain.holdNextRead(isNewTokenRead),
        card: async () => cardOpenOf(install, launcher),
      };
      await reached[point]();
      return kill();
    }
    if ((point === "asked" || point === "signed") && step === 1) {
      await chain.nextSend(launcher.address);
    }
    const at = { point, fromNonce: step };
    const killAt =
      point === "receipt" ? async () => untilIncluded(install, launcher).then(kill) : kill;
    return killWhenReached(world, at, killAt);
  });
}

// Settles once the engine is dead. A launch that fails while the engine still runs fails the run
// with its error; one the kill cut off fails a moment after the kill, which settles first.
async function untilKilled(killed: Promise<void>, launching: Promise<void>): Promise<void> {
  const failed = launching.then(
    async () => killed,
    async (error: unknown) => {
      await wait(2_000);
      throw error;
    },
  );
  failed.catch(() => undefined);
  await Promise.race([killed, failed]);
}

// Restarts the killed run's engine with blocks mined until the launch ended, and reads what
// reached the chain, custody and Flap, and what the store holds.
async function restarted(
  run: LaunchRun,
  killed: { readonly first: SourceProgram; readonly atKill: AtKill; readonly before: number },
): Promise<LaunchOutcome> {
  const { chain, services } = harness.worldOf();
  const { install, launcher, killCase } = run;
  const from = launcher.address;
  const stateAtKill = await stateOf(install);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const signedAtKill = services.signatures();
  const settle = async () => settleLaunchAndStop(install, launcher);
  const isMinedAfterResend = killed.atKill.isRelayed && killCase.isResent;
  const restart = { isMinedAfterResend, fills: false, settle, from };
  const second = await restartWith(harness, install, restart);
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    stateAtKill,
    atKill: killed.atKill,
    sends,
    isResent: sends.length > sendsAtKill,
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    uploads: services.flap.uploads(),
    signatures: {
      beforeKill: signedAtKill - killed.before,
      afterRestart: services.signatures() - signedAtKill,
    },
    restartExit: await second.engine.program.exited,
    settled: second.settled,
    stored: await storedLaunchOf(install.machine.folder, launcher),
    story: await storyOf(install.machine.folder, [killed.first, second.engine]),
  };
}

async function crashLaunchOnce(killCase: LaunchKillCase): Promise<LaunchOutcome> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, harness.folders);
  const first = await harness.startEngine(install);
  const launcher = await setUpLauncher(world, install);
  services.flap.serve({ cid, pins });
  const before = services.signatures();
  const run = { install, launcher, killCase };
  const killed = armed(first, run);
  // A kill on the create call waits for the approval to land first: blocks are mined until it.
  const miner = new AbortController();
  const mining = killCase.step === 1 ? chain.mine(miner.signal) : Promise.resolve();
  const tap = killCase.point !== "card";
  const launching = launchAndTap(install, { launcher, pair: killCase.pair, tap });
  await untilKilled(killed, launching).finally(() => miner.abort());
  await mining;
  const atKill = await atKillOf(chain, launcher.address, install.machine.folder);
  return restarted(run, { first, atKill, before });
}

const notSigned = { isRelayed: false, isOnChain: false, mined: 0, stored: [] };
const unmined = { isRelayed: true, isOnChain: true, mined: 0 };
const approved = { isRelayed: true, isOnChain: true, mined: 1 };
const noSignature = { beforeKill: 0, afterRestart: 0 };
// A launch the restarted engine takes on to its card: the owner confirms it, and its create call
// is the one signature.
const toCard = {
  pair: "coin",
  step: 0,
  atKill: notSigned,
  end: "reconciled",
  sent: 1,
  isResent: true,
  signatures: { beforeKill: 0, afterRestart: 1 },
  isTappedAfter: true,
  notices: [],
} as const;
// A launch whose create call was signed before the stop, and stored: recovery follows it to its
// end, sending the stored bytes again while they are unmined, and signs nothing.
const followed = {
  pair: "coin",
  step: 0,
  stateAtKill: "executing",
  end: "reconciled",
  sent: 1,
  isResent: true,
  signatures: { beforeKill: 1, afterRestart: 0 },
  isTappedAfter: false,
  notices: [],
} as const;
// A launch the stop left after the tap with nothing stored to send: recovery ends it unsigned.
const unsigned = {
  pair: "coin",
  step: 0,
  stateAtKill: "executing",
  atKill: notSigned,
  end: "cancelled",
  sent: 0,
  isResent: false,
  isTappedAfter: false,
  notices: ["notice.launchNotSigned"],
} as const;
// A token pair's launch stopped between its approval and its create call: recovery follows the
// approval to its block, never signs the create call, and ends the launch `step_unsent`.
const approvalOnly = {
  pair: "usdt",
  stateAtKill: "executing",
  end: "failed_onchain",
  sent: 1,
  signatures: { beforeKill: 1, afterRestart: 0 },
  isTappedAfter: false,
  notices: ["notice.launchStepUnsent"],
} as const;
// A token pair's launch whose create call was signed after its approval landed.
const createFollowed = {
  ...followed,
  pair: "usdt",
  step: 1,
  sent: 2,
  signatures: { beforeKill: 2, afterRestart: 0 },
} as const;

// Before the card a stop leaves the launch where it got to: one that began its upload and never
// heard back ends `upload_lost` with the owner's notice, and one further on waits for its pin and
// opens its card, and nothing is uploaded again. After the tap a stop before the create call is
// stored leaves nothing to send: recovery ends it unsigned. Anywhere after, each step's one
// transaction reaches the chain, and the launch reconciles once.
const launchKillCases: readonly LaunchKillCase[] = [
  {
    pair: "coin",
    point: "upload",
    step: 0,
    stateAtKill: "checked",
    atKill: notSigned,
    end: "failed_check",
    sent: 0,
    isResent: false,
    signatures: noSignature,
    isTappedAfter: false,
    notices: ["notice.launchStopped"],
  },
  { ...toCard, point: "pin", stateAtKill: "quoted" },
  { ...toCard, point: "pinned", stateAtKill: "assessed" },
  { ...toCard, point: "card", stateAtKill: "awaiting_confirmation" },
  { ...unsigned, point: "asked", signatures: noSignature },
  { ...unsigned, point: "signed", signatures: { beforeKill: 1, afterRestart: 0 } },
  { ...followed, point: "stored", atKill: { ...notSigned, isRelayed: true, stored: ["signed"] } },
  { ...followed, point: "relayed", atKill: { ...unmined, stored: ["signed"] } },
  { ...followed, point: "sent", atKill: { ...unmined, stored: ["sent"] } },
  {
    ...followed,
    point: "included",
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: false,
  },
  {
    ...followed,
    point: "receipt",
    stateAtKill: "included",
    atKill: { ...unmined, mined: 1, stored: ["included"] },
    isResent: false,
  },
  {
    ...approvalOnly,
    point: "stored",
    step: 0,
    atKill: { ...notSigned, isRelayed: true, stored: ["signed"] },
    isResent: true,
  },
  {
    ...approvalOnly,
    point: "sent",
    step: 0,
    atKill: { ...unmined, stored: ["sent"] },
    isResent: true,
  },
  {
    ...approvalOnly,
    point: "included",
    step: 0,
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: false,
  },
  {
    ...approvalOnly,
    point: "asked",
    step: 1,
    atKill: { ...approved, stored: ["included"] },
    isResent: false,
  },
  { ...createFollowed, point: "stored", atKill: { ...approved, stored: ["included", "signed"] } },
  { ...createFollowed, point: "sent", atKill: { ...approved, stored: ["included", "sent"] } },
  {
    ...createFollowed,
    point: "included",
    atKill: { ...approved, mined: 2, stored: ["included", "sent"] },
    isResent: false,
  },
  {
    ...createFollowed,
    point: "receipt",
    stateAtKill: "included",
    atKill: { ...approved, mined: 2, stored: ["included", "included"] },
    isResent: false,
  },
];

// The launch's record once it ended: one launch, its one card closed by the tap, its notices, and,
// once its create call landed, one feed record of its token, one execution and the first buy held.
// The states it went through are checked apart.
function storedFor(killCase: LaunchKillCase): Omit<StoredLaunchRun, "path"> {
  const isLanded = killCase.end === "reconciled";
  return {
    launches: 1,
    state: killCase.end,
    cards: killCase.stateAtKill === "checked" ? [] : ["confirmed"],
    notices: killCase.notices,
    feed: isLanded ? 1 : 0,
    executions: isLanded ? 1 : 0,
    held: isLanded ? [crashFirstBuys[killCase.pair] * launchTokensPerUnit] : [],
  };
}

describe.each(launchKillCases)(
  "an engine killed at $point of step $step during a launch against the $pair",
  (killCase) => {
    it.each(runs)("sends each step once and records the launch once, run %i", async () => {
      const outcome = await crashLaunchOnce(killCase);
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      const hashes = [...new Set(outcome.sends.map(({ hash }) => hash))];
      const nonces = new Set(outcome.sends.map(({ nonce }) => nonce));
      expect(outcome.stateAtKill).toBe(killCase.stateAtKill);
      expect(outcome.atKill).toStrictEqual(killCase.atKill);
      expect([hashes.length, nonces.size]).toStrictEqual([killCase.sent, killCase.sent]);
      expect(outcome.landed.toSorted()).toStrictEqual(hashes.toSorted());
      expect([outcome.mined, outcome.unmined]).toStrictEqual([killCase.sent, 0]);
      expect(outcome.isResent).toBe(killCase.isResent);
      expect(outcome.signatures).toStrictEqual(killCase.signatures);
      expect(outcome.uploads).toBe(1);
      expect(outcome.restartExit).toBe(0);
      expect(outcome.settled).toMatchObject({
        state: killCase.end,
        isTappedAfter: killCase.isTappedAfter,
      });
      const { path, ...stored } = outcome.stored;
      expect(stored).toStrictEqual(storedFor(killCase));
      // The launch went through each state once, to its end.
      expect([new Set(path).size, path.at(-1)]).toStrictEqual([path.length, killCase.end]);
    });
  },
);
