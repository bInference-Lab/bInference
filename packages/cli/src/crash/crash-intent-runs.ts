import { setTimeout as wait } from "node:timers/promises";
import type { Id } from "@binference/core";
import { createSqlitePositionStore } from "@binference/store";
import type { Address, Hex } from "viem";
import type { SourceProgram } from "../e2e/source-program.js";
import type { KillPoint, RelayedSend } from "./crash-chain.js";
import {
  armKillWith,
  type CrashHarness,
  killWhenReached,
  restartWith,
  storyOf,
} from "./crash-harness.js";
import {
  type AtKill,
  atKillOf,
  atRest,
  hashesOf,
  landedOf,
  minedOf,
  unminedOf,
  withStore,
} from "./crash-reads.js";
import {
  type CrashInstall,
  type CrashRequestOf,
  type CrashWorld,
  goLiveAndPropose,
  settleAndStop,
  setUpCrashInstall,
} from "./crash-runs.js";

/** What a run at one kill point of an intent the owner proposes and confirms does and must show. */
export interface IntentKillCase {
  readonly point: KillPoint | "delivery";
  /**
   * Waits for `delivery`, a point the chain's side does not see: a bridge's first read of its
   * delivery. The engine is killed once it settles, with blocks mined until then.
   */
  readonly reach?: () => Promise<void>;
  /** The step whose transaction the kill waits for: the first (0), or the second (1). */
  readonly step: 0 | 1;
  readonly atKill: AtKill;
  /** The intent's end once the restarted engine recovered it. */
  readonly state: "cancelled" | "reconciled" | "failed_onchain";
  /** The distinct transactions that reach the relays and the chain: one per step sent. */
  readonly sent: 0 | 1 | 2;
  /** Whether recovery sends the stored bytes again: the transaction is unmined when it reads. */
  readonly isResent: boolean;
  /** Signatures custody makes before the kill; none after the restart. */
  readonly signatures: number;
}

/** What reached the chain from one run's wallet, and what each engine reported. */
export interface IntentOutcome {
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
  /** How far the run moved its effect's number on the chain. */
  readonly moved: bigint;
  /** The rows of the run's kind the store keeps for the intent. */
  readonly rows: number;
  /** The states the intent moved through, the first first, and the executions it recorded. */
  readonly booked: { readonly path: readonly string[]; readonly executions: number };
  readonly story: string;
}

// The states the intent moved through and the live executions recorded for it.
async function bookedOf(folder: string, intent: Id<"int">): Promise<IntentOutcome["booked"]> {
  return withStore(folder, async (stores, signal, database) => {
    const events = await stores.intents.events(intent, { signal });
    const positions = createSqlitePositionStore(database);
    const page = { after: 0, limit: 100, isPaper: false };
    const executions = await positions.executions(page, { signal });
    return {
      path: events.map(({ toState }) => toState),
      executions: executions.filter(({ intentId }) => intentId === intent).length,
    };
  });
}

/** How a run's intent is made: its request, and what the install needs before the proposal. */
export interface IntentRun {
  readonly requestOf: CrashRequestOf;
  /** The live executions a landed intent of the run records: one for a trade, none for a send. */
  readonly executions: 0 | 1;
  /** Sets up what the request needs, once the engine runs; answers the wallet that sends. */
  readonly prepare?: (world: CrashWorld, install: CrashInstall) => Promise<Address>;
  /** Rows of the run's kind the store keeps for the intent, and how many a landed one keeps. */
  readonly rows?: {
    readonly read: (folder: string, intent: Id<"int">) => Promise<number>;
    readonly landed: number;
  };
  /** A number on the chain the intent moves once it lands, by `moves`: none when absent. */
  readonly effect?: {
    readonly read: (world: CrashWorld, install: CrashInstall) => Promise<bigint>;
    readonly moves: bigint;
  };
}

// Waits until the store holds the step's transaction in a block, as the engine read its receipt.
async function untilIncluded(
  world: CrashWorld,
  at: { readonly install: CrashInstall; readonly from: Address; readonly step: number },
): Promise<void> {
  const atKill = await atKillOf(world.chain, at.from, at.install.machine.folder);
  if (atKill.stored[at.step] === "included") {
    return;
  }
  await wait(100);
  return untilIncluded(world, at);
}

// Kills the engine at the case's point of its step: a kill on the second step once custody signed
// it waits for the first step's send, and one at `receipt` until the store holds the receipt the
// engine read.
async function armed(
  world: CrashWorld,
  first: SourceProgram,
  at: { readonly install: CrashInstall; readonly from: Address; readonly killCase: IntentKillCase },
): Promise<void> {
  const { point, step, reach } = at.killCase;
  return armKillWith(first, point, async (kill) => {
    if (point === "delivery") {
      await reach?.();
      return kill();
    }
    if (point === "signed" && step === 1) {
      await world.chain.nextSend(at.from);
    }
    const killAt =
      point === "receipt" ? async () => untilIncluded(world, { ...at, step }).then(kill) : kill;
    return killWhenReached(world, { point, fromNonce: step }, killAt);
  });
}

/** One run killed at its point: its install, intent and first engine, and what held then. */
interface KilledRun {
  readonly install: CrashInstall;
  readonly intent: Id<"int">;
  readonly first: SourceProgram;
  /** The wallet that sends. */
  readonly from: Address;
  readonly atKill: AtKill;
  readonly sendsAtKill: number;
  readonly signed: { readonly before: number; readonly atKill: number };
  readonly effectBefore: bigint | undefined;
}

// A fresh install, an engine the owner goes live on, proposes the run's request to and confirms,
// killed at the case's point.
async function killedRun(
  harness: CrashHarness,
  run: IntentRun,
  killCase: IntentKillCase,
): Promise<KilledRun> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, harness.folders);
  const before = services.signatures();
  const first = await harness.startEngine(install);
  const from = (await run.prepare?.(world, install)) ?? install.from;
  const effectBefore = await run.effect?.read(world, install);
  const killed = armed(world, first, { install, from, killCase });
  // A kill on the second step waits for the first to land, and one beyond the chain's side for
  // every step to: blocks are mined until the kill.
  const miner = new AbortController();
  const isMined = killCase.step === 1 || killCase.point === "delivery";
  const mining = isMined ? chain.mine(miner.signal) : Promise.resolve();
  const intent = await goLiveAndPropose(install, run.requestOf);
  await killed.finally(() => miner.abort());
  await mining;
  return {
    install,
    intent,
    first,
    from,
    atKill: await atKillOf(chain, from, install.machine.folder),
    sendsAtKill: chain.sends().filter((send) => send.from === from).length,
    signed: { before, atKill: services.signatures() },
    effectBefore,
  };
}

/**
 * Runs one intent to a forced stop at the case's kill point and recovers it: a fresh install,
 * an engine that the owner goes live on, proposes `run`'s request to and confirms, killed at the
 * point, then a second engine on the same folder with blocks mined until the intent ends. What
 * reached the chain is read from the relays and anvil, the signatures from the test's Privy.
 */
export async function crashIntentOnce(
  harness: CrashHarness,
  run: IntentRun,
  killCase: IntentKillCase,
): Promise<IntentOutcome> {
  const world = harness.worldOf();
  const { chain, services } = world;
  const killed = await killedRun(harness, run, killCase);
  const { install, intent, from, signed } = killed;
  const settle = async () => settleAndStop(install, intent);
  const restart = { isMinedAfterResend: killCase.isResent, fills: false, settle, from };
  const second = await restartWith(harness, install, restart);
  const sends = chain.sends().filter((send) => send.from === from);
  const effectAfter = await run.effect?.read(world, install);
  const { folder } = install.machine;
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
    settled: { state: second.settled, hashes: await hashesOf(folder, intent) },
    moved: (effectAfter ?? 0n) - (killed.effectBefore ?? 0n),
    rows: (await run.rows?.read(folder, intent)) ?? 0,
    booked: await bookedOf(folder, intent),
    story: await storyOf(folder, [killed.first, second.engine]),
  };
}

/** What a run showed of its sends, or what its case says it must show. */
export interface SentSummary {
  readonly atKill: AtKill;
  /** The distinct transactions and nonces that reached the relays. */
  readonly distinct: { readonly hashes: number; readonly nonces: number };
  /** Whether every distinct transaction landed, and the engine stored each and no other. */
  readonly isEachLanded: boolean;
  readonly isEachStored: boolean;
  readonly mined: number;
  readonly unmined: number;
  readonly isResent: boolean;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  readonly restartExit: number | undefined;
  readonly state: string;
  /** Whether the intent moved through each state once. */
  readonly isEachStateOnce: boolean;
  /** The live executions recorded for the intent. */
  readonly executions: number;
  /** How far the intent moved its run's number on the chain. */
  readonly moved: bigint;
  /** The rows of the run's kind the store keeps for the intent. */
  readonly rows: number;
}

const sameHashes = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify(left.toSorted()) === JSON.stringify(right.toSorted());

/** What the run showed of its sends, for its test to hold against {@link sentOnceOf}. */
export function sentSummaryOf(outcome: IntentOutcome): SentSummary {
  const hashes = [...new Set(outcome.sends.map(({ hash }) => hash))];
  return {
    atKill: atRest(outcome.atKill),
    distinct: {
      hashes: hashes.length,
      nonces: new Set(outcome.sends.map(({ nonce }) => nonce)).size,
    },
    isEachLanded: sameHashes(outcome.landed, hashes),
    isEachStored: sameHashes(outcome.settled.hashes, hashes),
    mined: outcome.mined,
    unmined: outcome.unmined,
    isResent: outcome.isResent,
    signatures: outcome.signatures,
    restartExit: outcome.restartExit,
    state: outcome.settled.state,
    isEachStateOnce: new Set(outcome.booked.path).size === outcome.booked.path.length,
    executions: outcome.booked.executions,
    moved: outcome.moved,
    rows: outcome.rows,
  };
}

/**
 * What a run of the case must show: each step's one transaction reached the chain, mined once
 * with no nonce repeated, nothing left in the pool, no signature after the restart, and the intent
 * at its end with the transactions it stored, through each state once, with the run's executions
 * recorded once and its effect on the chain made once if it reconciled.
 */
export function sentOnceOf(killCase: IntentKillCase, run: IntentRun): SentSummary {
  const { sent } = killCase;
  return {
    atKill: killCase.atKill,
    distinct: { hashes: sent, nonces: sent },
    isEachLanded: true,
    isEachStored: true,
    mined: sent,
    unmined: 0,
    isResent: killCase.isResent,
    signatures: { beforeKill: killCase.signatures, afterRestart: 0 },
    restartExit: 0,
    state: killCase.state,
    isEachStateOnce: true,
    executions: killCase.state === "reconciled" ? run.executions : 0,
    moved: killCase.state === "reconciled" ? (run.effect?.moves ?? 0n) : 0n,
    rows: killCase.state === "reconciled" ? (run.rows?.landed ?? 0) : 0,
  };
}

const unrelayed = { isRelayed: false, isOnChain: false, mined: 0 };
const unmined = { isRelayed: true, isOnChain: true, mined: 0 };
const oneSigned = { step: 0, signatures: 1 } as const;

/**
 * The kill points of an intent of one step. A kill before the bytes are stored leaves nothing to
 * send: the intent ends unsent. A kill anywhere after leaves one transaction, which recovery
 * follows by hash and nonce to its end: still unmined, it goes again with the same bytes; in a
 * block, it is read from there.
 */
export const oneStepKillCases: Readonly<Record<KillPoint, IntentKillCase>> = {
  signed: {
    ...oneSigned,
    point: "signed",
    atKill: { ...unrelayed, stored: [] },
    state: "cancelled",
    sent: 0,
    isResent: false,
  },
  stored: {
    ...oneSigned,
    point: "stored",
    atKill: { ...unrelayed, isRelayed: true, stored: ["signed"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  relayed: {
    ...oneSigned,
    point: "relayed",
    atKill: { ...unmined, stored: ["signed"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  sent: {
    ...oneSigned,
    point: "sent",
    atKill: { ...unmined, stored: ["sent"] },
    state: "reconciled",
    sent: 1,
    isResent: true,
  },
  included: {
    ...oneSigned,
    point: "included",
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    state: "reconciled",
    sent: 1,
    isResent: false,
  },
  receipt: {
    ...oneSigned,
    point: "receipt",
    atKill: { ...unmined, mined: 1, stored: ["included"] },
    state: "reconciled",
    sent: 1,
    isResent: false,
  },
};
