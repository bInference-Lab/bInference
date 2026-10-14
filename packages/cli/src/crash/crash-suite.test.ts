import type { Id } from "@binference/core";
import type { Hex } from "viem";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { SourceProgram } from "../e2e/source-program.js";
import type { CrashChain, KillPoint, RelayedSend } from "./crash-chain.js";
import type { CrashContext } from "./crash-context.js";
import { armKill, restartWith, storyOf, useCrashHarness } from "./crash-harness.js";
import { type AtKill, atKillOf, hashesOf, landedOf, minedOf, unminedOf } from "./crash-reads.js";
import { type CrashInstall, goLiveAndBuy, settleAndStop, setUpCrashInstall } from "./crash-runs.js";

// Each run sets up a state folder with `binference init` and starts `binference start` on it as a
// program of its own, on the suite's one anvil chain: the owner goes live, proposes a swap and
// confirms it, and the test kills the engine outright at the run's kill point (SIGKILL, or
// TerminateProcess on Windows, through the platform's program); a second `binference start` on
// the same folder then recovers. What reached the chain is counted by the test's relays and by
// anvil itself, and the signatures by the test's Privy, never taken from the engine.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 29 });

/** The second engine of a run: how it ended, and what it left the run's intent at. */
interface Restarted {
  readonly engine: SourceProgram;
  readonly state: string;
}

async function restart(
  install: CrashInstall,
  run: { readonly intent: Id<"int">; readonly isMinedAfterResend: boolean },
): Promise<Restarted> {
  const { isMinedAfterResend } = run;
  const settle = async () => settleAndStop(install, run.intent);
  const { engine, settled } = await restartWith(harness, install, {
    isMinedAfterResend,
    fills: false,
    settle,
  });
  return { engine, state: settled };
}

/** What reached the chain from one run's wallet, and what each engine reported. */
interface RunOutcome {
  readonly atKill: AtKill;
  /** Each send the relays received from the wallet. */
  readonly sends: readonly RelayedSend[];
  /** Whether the relays received the wallet's bytes again after the restart. */
  readonly isResent: boolean;
  /** The wallet's transactions anvil has mined: its nonce at the latest block. */
  readonly mined: number;
  /** The wallet's transactions anvil still holds unmined. */
  readonly unmined: number;
  /** The hashes the relays passed on that anvil holds a successful receipt of. */
  readonly landed: readonly Hex[];
  /** Signatures custody made: before the kill, and after the restart. */
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  readonly restartExit: number | undefined;
  /** Where the restarted engine left the run's intent, and the transactions it stored for it. */
  readonly settled: { readonly state: string; readonly hashes: readonly string[] };
  readonly story: string;
}

/** One run as it went: its install, its intent, both engines and what held at the kill. */
interface CrashRun {
  readonly install: CrashInstall;
  readonly intent: Id<"int">;
  readonly first: SourceProgram;
  readonly second: Restarted;
  readonly atKill: AtKill;
  /** How many sends the relays had received from the wallet when the engine died. */
  readonly sendsAtKill: number;
  /** Signatures the test's Privy made: before the run, at the kill and at the end. */
  readonly signed: { readonly before: number; readonly atKill: number; readonly after: number };
}

async function outcomeOf(chain: CrashChain, run: CrashRun): Promise<RunOutcome> {
  const { install, first, second, signed } = run;
  const { from, machine } = install;
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    atKill: run.atKill,
    sends,
    isResent: sends.length > run.sendsAtKill,
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    signatures: {
      beforeKill: signed.atKill - signed.before,
      afterRestart: signed.after - signed.atKill,
    },
    restartExit: await second.engine.program.exited,
    settled: { state: second.state, hashes: await hashesOf(machine.folder, run.intent) },
    story: await storyOf(machine.folder, [first, second.engine]),
  };
}

/** What a run at one kill point does and must show. */
interface KillCase {
  readonly point: KillPoint;
  readonly atKill: AtKill;
  /** The intent's end once the restarted engine recovered it. */
  readonly state: "cancelled" | "reconciled";
  /** The distinct transactions that may reach the relays and the chain: none, or the one. */
  readonly sent: 0 | 1;
  /** Whether recovery sends the stored bytes again: the transaction is unmined when it reads. */
  readonly isResent: boolean;
}

async function crashOnce(killCase: KillCase): Promise<RunOutcome> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const { point, isResent } = killCase;
  const install = await setUpCrashInstall(world, harness.folders);
  const { from } = install;
  const before = services.signatures();
  const first = await harness.startEngine(install);
  const killed = armKill(world, first, { point });
  const intent = await goLiveAndBuy(install);
  await killed;
  const atKill = await atKillOf(chain, from, install.machine.folder);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const signedAtKill = services.signatures();
  const second = await restart(install, { intent, isMinedAfterResend: isResent });
  const signed = { before, atKill: signedAtKill, after: services.signatures() };
  return outcomeOf(chain, { install, intent, first, second, atKill, sendsAtKill, signed });
}

const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const unrelayed = { isRelayed: false, isOnChain: false, mined: 0 };
const unmined = { isRelayed: true, isOnChain: true, mined: 0 };

// A kill before the bytes are stored leaves nothing to send: the intent ends unsent. A kill
// anywhere after leaves one transaction, which recovery follows by hash and nonce to its end:
// still unmined, it goes again with the same bytes; in a block, it is read from there.
const killCases: readonly KillCase[] = [
  {
    point: "signed",
    atKill: { ...unrelayed, stored: [] },
    state: "cancelled",
    sent: 0,
    isResent: false,
  },
  {
    point: "stored",
    atKill: { ...unrelayed, isRelayed: true, stored: ["signed"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  {
    point: "relayed",
    atKill: { ...unmined, stored: ["signed"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  {
    point: "sent",
    atKill: { ...unmined, stored: ["sent"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  {
    point: "included",
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    state: "reconciled",
    sent: 1,
    isResent: false,
  },
];

describe.each(killCases)("an engine killed at $point and started again", (killCase) => {
  it.each(runs)("sends one transaction at most, run %i", async () => {
    const outcome = await crashOnce(killCase);
    // A failed run shows what both engines reported and what the engine log holds.
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    const hashes = [...new Set(outcome.sends.map(({ hash }) => hash))];
    expect(outcome.atKill).toStrictEqual(killCase.atKill);
    expect(hashes).toHaveLength(killCase.sent);
    expect(outcome.landed).toStrictEqual(hashes);
    expect(outcome.mined).toBe(killCase.sent);
    expect(outcome.unmined).toBe(0);
    expect(outcome.isResent).toBe(killCase.isResent);
    expect(outcome.signatures).toStrictEqual({ beforeKill: 1, afterRestart: 0 });
    expect(outcome.restartExit).toBe(0);
    expect(outcome.settled).toStrictEqual({ state: killCase.state, hashes });
  });
});
