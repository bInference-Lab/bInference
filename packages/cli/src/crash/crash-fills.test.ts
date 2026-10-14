import type { ProtocolId } from "@binference/protocol";
import type { Hex } from "viem";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { SourceProgram } from "../e2e/source-program.js";
import type { RelayedSend } from "./crash-chain.js";
import type { CrashContext } from "./crash-context.js";
import {
  armKill,
  killerOf,
  restartWith,
  type RunKillPoint,
  storyOf,
  useCrashHarness,
} from "./crash-harness.js";
import {
  type AtKill,
  atKillOf,
  hashesOf,
  landedOf,
  minedOf,
  unminedOf,
  withStore,
} from "./crash-reads.js";
import {
  type CrashInstall,
  type CrashOrderKind,
  droppedFillOf,
  goLiveAndOrder,
  type SettledOrder,
  settleOrderAndStop,
  setUpCrashInstall,
} from "./crash-runs.js";

// Each run makes a live auto order on a fresh install, which the crash engine's prices fire at
// the next block, and kills the engine outright at the run's point of the fill: as custody is
// asked to sign, once it signed, or at a point of the chain's on the step the run names. A second
// engine on the same folder then recovers the fill and the order. What reached the chain is
// counted by the test's relays and by anvil itself, and the signatures by the test's Privy.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 31 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const unrelayed = { isRelayed: false, isOnChain: false, mined: 0 };
const unmined = { isRelayed: true, isOnChain: true, mined: 0 };

/** What a run at one kill point during a live order fill does and must show. */
interface FillKillCase {
  /** The order the run fills: a one-fill buy, or a sale of all the wallet's USDT in two steps. */
  readonly kind: CrashOrderKind;
  readonly point: RunKillPoint;
  /** The step whose transaction the kill waits for: the sale's approval (0) or its swap (1). */
  readonly step: 0 | 1;
  readonly atKill: AtKill;
  /** Whether the relays get the wallet's bytes after the restart: the stored ones, or a new fill. */
  readonly isResent: boolean;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  /** The skips the order records before its one fill: a fill the stop left unsigned. */
  readonly skips: readonly string[];
}

/** What reached the chain from one fill run's wallet, and where its order ended. */
interface FillOutcome {
  readonly atKill: AtKill;
  readonly sends: readonly RelayedSend[];
  readonly isResent: boolean;
  readonly mined: number;
  readonly unmined: number;
  readonly landed: readonly Hex[];
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  readonly restartExit: number | undefined;
  readonly order: SettledOrder;
  /** The order's fill rows, the oldest first: each outcome, with a skip's reason. */
  readonly rows: readonly { readonly outcome: string; readonly reason?: string }[];
  /** The transactions the engine stored for the intent of the order's `filled` rows. */
  readonly filledHashes: readonly string[];
  readonly story: string;
}

// The order's fill rows as the engine stored them, the oldest first, and the transactions it
// stored for the intents its `filled` rows name.
async function fillsOf(folder: string, order: ProtocolId<"autoOrder">) {
  const rows = await withStore(folder, async ({ orders }, signal) =>
    orders.fills({ orderId: order, limit: 20 }, { signal }),
  );
  const filled = rows.filter(({ outcome }) => outcome === "filled");
  const hashes = await Promise.all(
    filled.map(async ({ intentId }) => (intentId === undefined ? [] : hashesOf(folder, intentId))),
  );
  const oldestFirst = rows
    .toReversed()
    .map(({ outcome, reason }) => (reason === undefined ? { outcome } : { outcome, reason }));
  return { rows: oldestFirst, filledHashes: hashes.flat() };
}

/** One fill run's install, order and first engine, with what held the moment it died. */
interface KilledFill {
  readonly install: CrashInstall;
  readonly order: ProtocolId<"autoOrder">;
  readonly first: SourceProgram;
  readonly atKill: AtKill;
  readonly sendsAtKill: number;
  readonly signed: { readonly before: number; readonly atKill: number };
}

// Restarts a killed fill run's engine with blocks mined until its order settled, and reads what
// reached the chain, what custody signed and what the order recorded.
async function settledFill(
  killed: KilledFill,
  run: { readonly isMinedAfterResend: boolean },
): Promise<FillOutcome> {
  const { chain, services } = harness.worldOf();
  const { install, order, first, signed } = killed;
  const { from, machine } = install;
  const settle = async () => settleOrderAndStop(install, order);
  const second = await restartWith(harness, install, { ...run, fills: true, settle });
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    atKill: killed.atKill,
    sends,
    isResent: sends.length > killed.sendsAtKill,
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    signatures: {
      beforeKill: signed.atKill - signed.before,
      afterRestart: services.signatures() - signed.atKill,
    },
    restartExit: await second.engine.program.exited,
    order: second.settled,
    ...(await fillsOf(machine.folder, order)),
    story: await storyOf(machine.folder, [first, second.engine]),
  };
}

async function crashFillOnce(killCase: FillKillCase): Promise<FillOutcome> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, harness.folders);
  const { from, machine } = install;
  const before = services.signatures();
  const first = await harness.startEngine(install, { fills: true });
  const killed = armKill(world, first, { point: killCase.point, fromNonce: killCase.step });
  // A kill at the swap waits for the approval to land first: blocks are mined until the kill.
  const miner = new AbortController();
  const mining = killCase.step === 1 ? chain.mine(miner.signal) : Promise.resolve();
  const order = await goLiveAndOrder(world, install, killCase.kind);
  await killed.finally(() => miner.abort());
  await mining;
  const atKill = await atKillOf(chain, from, machine.folder);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const signed = { before, atKill: services.signatures() };
  const isMinedAfterResend = killCase.point !== "included";
  const run = { install, order, first, atKill, sendsAtKill, signed };
  return settledFill(run, { isMinedAfterResend });
}

const notSigned = { isRelayed: false, isOnChain: false, mined: 0, stored: [] };
// The sale's approval landed before the kill, which waits for its swap: in a block, read as
// `included` or `final` as far as the engine got.
const approved = { isRelayed: true, isOnChain: true, mined: 1 };
const approvalAtRest = "included";

// A transaction in a block as the engine stored it, whether it read the block once or as final.
function atRest(atKill: AtKill): AtKill {
  return {
    ...atKill,
    stored: atKill.stored.map((state) => (state === "final" ? "included" : state)),
  };
}

// A stop before the fill's bytes are stored leaves nothing to send: recovery ends the fill
// unsigned, the order records the skip, and the next price fills it once. A stop anywhere after
// leaves one transaction, which recovery follows to its end and records on the order; the prices
// that fire meanwhile wait behind it. A sale has two steps, its approval and its swap: a stop at
// either leaves its transaction to recovery, and the steps after it are signed once. Either way
// each step's one transaction reaches the chain, and the order records one fill.
const fillKillCases: readonly FillKillCase[] = [
  {
    kind: "buy",
    point: "asked",
    step: 0,
    atKill: notSigned,
    isResent: true,
    signatures: { beforeKill: 0, afterRestart: 1 },
    skips: ["fill_failed"],
  },
  {
    kind: "buy",
    point: "signed",
    step: 0,
    atKill: notSigned,
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 1 },
    skips: ["fill_failed"],
  },
  {
    kind: "buy",
    point: "stored",
    step: 0,
    atKill: { ...unrelayed, isRelayed: true, stored: ["signed"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
  {
    kind: "buy",
    point: "sent",
    step: 0,
    atKill: { ...unmined, stored: ["sent"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
  {
    kind: "buy",
    point: "included",
    step: 0,
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: false,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
  {
    kind: "sale",
    point: "asked",
    step: 0,
    atKill: notSigned,
    isResent: true,
    signatures: { beforeKill: 0, afterRestart: 2 },
    skips: ["fill_failed"],
  },
  {
    kind: "sale",
    point: "stored",
    step: 0,
    atKill: { ...unrelayed, isRelayed: true, stored: ["signed"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 1 },
    skips: [],
  },
  {
    kind: "sale",
    point: "sent",
    step: 0,
    atKill: { ...unmined, stored: ["sent"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 1 },
    skips: [],
  },
  {
    kind: "sale",
    point: "included",
    step: 0,
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 1 },
    skips: [],
  },
  {
    kind: "sale",
    point: "stored",
    step: 1,
    atKill: { ...approved, stored: [approvalAtRest, "signed"] },
    isResent: true,
    signatures: { beforeKill: 2, afterRestart: 0 },
    skips: [],
  },
  {
    kind: "sale",
    point: "sent",
    step: 1,
    atKill: { ...approved, stored: [approvalAtRest, "sent"] },
    isResent: true,
    signatures: { beforeKill: 2, afterRestart: 0 },
    skips: [],
  },
  {
    kind: "sale",
    point: "included",
    step: 1,
    atKill: { ...approved, mined: 2, stored: [approvalAtRest, "sent"] },
    isResent: false,
    signatures: { beforeKill: 2, afterRestart: 0 },
    skips: [],
  },
];

// The steps a fill of the order's kind sends: a buy's swap, or a sale's approval and swap.
const stepsOf = (kind: CrashOrderKind): number => (kind === "buy" ? 1 : 2);

describe.each(fillKillCases)(
  "an engine killed at $point of step $step during a live $kind order fill",
  (killCase) => {
    it.each(runs)("sends each step once and records one fill, run %i", async () => {
      const outcome = await crashFillOnce(killCase);
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      const hashes = [...new Set(outcome.sends.map(({ hash }) => hash))];
      const steps = stepsOf(killCase.kind);
      const { order } = outcome;
      expect(atRest(outcome.atKill)).toStrictEqual(killCase.atKill);
      expect(hashes).toHaveLength(steps);
      expect(outcome.landed.toSorted()).toStrictEqual(hashes.toSorted());
      expect([outcome.mined, outcome.unmined]).toStrictEqual([steps, 0]);
      expect(outcome.isResent).toBe(killCase.isResent);
      expect(outcome.signatures).toStrictEqual(killCase.signatures);
      expect(outcome.restartExit).toBe(0);
      expect([order.state, order.fills]).toStrictEqual(["filled", 1]);
      const skips = killCase.skips.map((reason) => ({ outcome: "skipped", reason }));
      expect(outcome.rows).toStrictEqual([...skips, { outcome: "filled" }]);
      expect(outcome.filledHashes.toSorted()).toStrictEqual(hashes.toSorted());
    });
  },
);

// A buy's fill every relay turns away until the drop rule drops it; the engine dies while it
// watches the dropped fill. Its last transaction then lands after all, as a relay that kept it
// sends it on, and the restarted engine counts it.
async function droppedThenLanded(): Promise<FillOutcome & { readonly lateHash: string }> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, harness.folders);
  const { from, machine } = install;
  const before = services.signatures();
  chain.refuseSends();
  const first = await harness.startEngine(install, { fills: true });
  const miner = new AbortController();
  const mining = chain.mine(miner.signal);
  const order = await goLiveAndOrder(world, install, "buy");
  const fill = await droppedFillOf(install).finally(() => miner.abort());
  await mining;
  const signedAtDrop = services.signatures();
  const { kill } = killerOf(first);
  await kill();
  chain.acceptSends();
  const atKill = await atKillOf(chain, from, machine.folder);
  const stored = await withStore(machine.folder, async ({ transactions }, signal) =>
    transactions.ofIntent(fill, { signal }),
  );
  const last = stored.at(-1);
  await chain.call("eth_sendRawTransaction", [last?.raw ?? "0x"]);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const signed = { before, atKill: signedAtDrop };
  const run = { install, order, first, atKill, sendsAtKill, signed };
  const outcome = await settledFill(run, { isMinedAfterResend: false });
  return { ...outcome, lateHash: last?.hash ?? "" };
}

describe("an engine killed while it watches a dropped live fill", () => {
  it.each(runs)(
    "fills nothing more meanwhile and counts the late landing once, run %i",
    async () => {
      const outcome = await droppedThenLanded();
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      const { order } = outcome;
      expect(outcome.atKill).toMatchObject({ isOnChain: false, mined: 0 });
      expect(outcome.sends.every(({ isOnChain }) => !isOnChain)).toBe(true);
      expect([outcome.mined, outcome.unmined]).toStrictEqual([1, 0]);
      expect(outcome.isResent).toBe(false);
      expect(outcome.signatures.afterRestart).toBe(0);
      expect(outcome.restartExit).toBe(0);
      expect([order.state, order.fills]).toStrictEqual(["filled", 1]);
      expect(outcome.rows).toStrictEqual([
        { outcome: "skipped", reason: "stuck_dropped" },
        { outcome: "filled" },
      ]);
      expect(outcome.filledHashes).toContain(outcome.lateHash);
    },
  );
});
