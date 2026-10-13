import { join } from "node:path";
import { evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import type { Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createFakePrivy } from "@binference/custody-privy/testing";
import type { EngineStores } from "@binference/engine";
import { readLogLines } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import type { ProtocolId } from "@binference/protocol";
import { createSqliteEngineStores, engineWorker, openDatabase } from "@binference/store";
import type { Address, Hex } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import { z } from "zod";
import type { SourceProgram } from "../e2e/source-program.js";
import { createSystemClock } from "../runtime/system-clock.js";
import {
  type CrashChain,
  type KillPoint,
  type RelayedSend,
  serveCrashChain,
} from "./crash-chain.js";
import type { CrashContext } from "./crash-context.js";
import { installCrashMarket } from "./crash-market.js";
import {
  type CrashInstall,
  type CrashWorld,
  goLiveAndBuy,
  goLiveAndOrder,
  type SettledOrder,
  settleAndStop,
  settleOrderAndStop,
  setUpCrashInstall,
  startCrashEngine,
} from "./crash-runs.js";
import { serveCrashServices } from "./crash-services.js";

// Each run sets up a state folder with `binference init` and starts `binference start` on it as a
// program of its own, on the suite's one anvil chain: the owner goes live, proposes a swap and
// confirms it, and the test kills the engine outright at the run's kill point (SIGKILL, or
// TerminateProcess on Windows, through the platform's program); a second `binference start` on
// the same folder then recovers. What reached the chain is counted by the test's relays and by
// anvil itself, and the signatures by the test's Privy, never taken from the engine.
const crash: CrashContext = inject("crash");
// One engine's whole run, from its start to its last intent's end.
const engineBudgetMs = 160_000;
const folders: TempFolder[] = [];
const programs: SourceProgram[] = [];
const held: { world?: CrashWorld } = {};

beforeAll(async () => {
  const chain = await serveCrashChain(crash.rpcUrl);
  // One random for every app, so no two runs' apps make the same wallet key.
  const random = createSeededRandom(29);
  const newPrivyApp = () => createFakePrivy({ clock: createSystemClock(), random });
  const services = await serveCrashServices();
  await installCrashMarket(async (method, params) => chain.call(method, params));
  held.world = { chain, services, newPrivyApp };
});

afterEach(async () => {
  held.world?.chain.stopKilling();
  await Promise.all(
    programs.splice(0).map(async ({ program }) => {
      program.kill();
      await program.exited;
    }),
  );
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

afterAll(async () => {
  await held.world?.chain.close();
  await held.world?.services.close();
});

function worldOf(): CrashWorld {
  if (held.world === undefined) {
    throw new Error("The crash chain did not start.");
  }
  return held.world;
}

async function startEngine(install: CrashInstall, fills = false): Promise<SourceProgram> {
  const signal = AbortSignal.timeout(engineBudgetMs);
  const engine = await startCrashEngine(worldOf(), install, { signal, fills });
  programs.push(engine);
  return engine;
}

// What a run did, for a failure's message: both engines' reports and the engine log.
async function storyOf(folder: string, engines: readonly SourceProgram[]): Promise<string> {
  const log = await readLogLines(join(folder, "logs", "engine.log"), {
    maxBytes: 200_000,
    signal: AbortSignal.timeout(10_000),
  });
  const logLines = log.ok ? log.value.lines : [];
  return [...engines.map((engine) => engine.lines().join("\n")), ...logLines].join("\n");
}

function killerOf(engine: SourceProgram) {
  const state = { isKilled: false };
  const kill = async (): Promise<void> => {
    state.isKilled = true;
    engine.program.kill();
    await engine.program.exited;
  };
  return { state, kill };
}

async function killOnChain(
  chain: CrashChain,
  point: Exclude<KillPoint, "signed">,
  kill: () => Promise<void>,
): Promise<void> {
  return new Promise((resolve) => {
    chain.killAt(point, async () => {
      await kill();
      resolve();
    });
  });
}

/** Where a run kills the engine: a point of the chain's, or `asked`, as custody is asked to sign. */
type RunKillPoint = KillPoint | "asked";

function isChainPoint(point: RunKillPoint): point is Exclude<KillPoint, "signed"> {
  return point !== "asked" && point !== "signed";
}

// Settles once custody is asked to sign, before it signs (`asked`), or once it signed and holds
// its answer (`signed`).
async function custodyKill(world: CrashWorld, point: "asked" | "signed"): Promise<void> {
  return point === "asked" ? world.services.holdNextRequest() : world.services.holdNextSignature();
}

// Arms the kill at the point: `asked` or `signed` at the test's Privy, every other point once the
// test's chain sees the engine reach it. Resolves once the engine is dead; an engine that ends by
// itself first fails the run.
async function armKill(
  world: CrashWorld,
  engine: SourceProgram,
  point: RunKillPoint,
): Promise<void> {
  const { state, kill } = killerOf(engine);
  const ended = (async () => {
    await engine.program.exited;
    if (!state.isKilled) {
      throw new Error(`The engine ended before ${point}:\n${engine.lines().join("\n")}`);
    }
  })();
  const killed = isChainPoint(point)
    ? killOnChain(world.chain, point, kill)
    : custodyKill(world, point).then(kill);
  await Promise.all([killed, ended]);
}

/** The second engine of a run: how it ended, and what it left the run's intent at. */
interface Restarted {
  readonly engine: SourceProgram;
  readonly state: string;
}

// Starts the engine again with blocks mined, as BSC moves on, waits until it has recovered the
// intent to its end, and stops it. A run whose transaction should still be unmined when recovery
// reads the chain mines only once the relays get the recovering engine's send.
async function restartWith<T>(
  install: CrashInstall,
  run: {
    readonly isMinedAfterResend: boolean;
    readonly fills: boolean;
    readonly settle: () => Promise<T>;
  },
): Promise<{ readonly engine: SourceProgram; readonly settled: T }> {
  const { chain } = worldOf();
  const miner = new AbortController();
  const stopped = new Promise<void>((resolve) => {
    miner.signal.addEventListener("abort", () => resolve());
  });
  const resent = Promise.race([chain.nextSend(install.from), stopped]);
  const start = run.isMinedAfterResend ? resent : Promise.resolve();
  const mining = start.then(async () => chain.mine(miner.signal));
  try {
    const engine = await startEngine(install, run.fills);
    const settled = await run.settle();
    await engine.program.exited;
    return { engine, settled };
  } finally {
    miner.abort();
    await mining;
  }
}

async function restart(
  install: CrashInstall,
  run: { readonly intent: Id<"int">; readonly isMinedAfterResend: boolean },
): Promise<Restarted> {
  const { isMinedAfterResend } = run;
  const settle = async () => settleAndStop(install, run.intent);
  const { engine, settled } = await restartWith(install, {
    isMinedAfterResend,
    fills: false,
    settle,
  });
  return { engine, state: settled };
}

const countSchema = z.string().regex(/^0x[0-9a-f]+$/);
const poolSchema = z.object({
  pending: z.record(z.string(), z.unknown()),
  queued: z.record(z.string(), z.unknown()),
});
const receiptSchema = z.object({ status: z.string() }).nullable();
// The parent opens engine.sqlite on store workers that run the TypeScript source too.
const storeExecArgv = ["--conditions=@binference/source", "--import", "tsx"];

/** What the chain, the relays and the engine's store held the moment the engine died. */
interface AtKill {
  /** Whether a relay had received the signed bytes. */
  readonly isRelayed: boolean;
  /** Whether anvil had them. */
  readonly isOnChain: boolean;
  /** The wallet's transactions anvil had mined. */
  readonly mined: number;
  /** The state of each transaction the engine had stored for the wallet. */
  readonly stored: readonly string[];
}

async function minedOf(chain: CrashChain, from: Address): Promise<number> {
  return Number(countSchema.parse(await chain.call("eth_getTransactionCount", [from, "latest"])));
}

// What the engine's store holds, read as the next engine reads it: the wallet's transactions,
// those of one intent, and an order's fill rows.
async function withStore<T>(
  folder: string,
  read: (stores: EngineStores, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(30_000);
  const database = await openDatabase({
    file: join(folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: storeExecArgv,
    signal,
  });
  try {
    return await read(createSqliteEngineStores(database), signal);
  } finally {
    await database.close();
  }
}

async function storedOf(folder: string, from: Address): Promise<readonly string[]> {
  const account = evmAccountRef(evmChainOf(bsc), from);
  const query = { account, fromNonce: 0, limit: 10 };
  const stored = await withStore(folder, async ({ transactions }, signal) =>
    transactions.list(query, { signal }),
  );
  return stored.map(({ state }) => state);
}

async function hashesOf(folder: string, intent: Id<"int">): Promise<readonly string[]> {
  const stored = await withStore(folder, async ({ transactions }, signal) =>
    transactions.ofIntent(intent, { signal }),
  );
  return stored.flatMap(({ hash }) => (hash === undefined ? [] : [hash]));
}

async function atKillOf(chain: CrashChain, from: Address, folder: string): Promise<AtKill> {
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    isRelayed: sends.length > 0,
    isOnChain: sends.some(({ isOnChain }) => isOnChain),
    mined: await minedOf(chain, from),
    stored: await storedOf(folder, from),
  };
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

async function landedOf(chain: CrashChain, sends: readonly RelayedSend[]): Promise<Hex[]> {
  const onChain = [...new Set(sends.filter((send) => send.isOnChain).map(({ hash }) => hash))];
  const receipts = await Promise.all(
    onChain.map(async (hash) =>
      receiptSchema.parse(await chain.call("eth_getTransactionReceipt", [hash])),
    ),
  );
  return onChain.filter((_, index) => receipts[index]?.status === "0x1");
}

async function unminedOf(chain: CrashChain, from: Address): Promise<number> {
  const pool = poolSchema.parse(await chain.call("txpool_content", []));
  const isFrom = (address: string): boolean => address.toLowerCase() === from.toLowerCase();
  return [...Object.keys(pool.pending), ...Object.keys(pool.queued)].filter(isFrom).length;
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
  const world = worldOf();
  const { chain, services } = world;
  const { point, isResent } = killCase;
  const install = await setUpCrashInstall(world, folders);
  const { from } = install;
  const before = services.signatures();
  const first = await startEngine(install);
  const killed = armKill(world, first, point);
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

/** What a run at one kill point during a live order fill does and must show. */
interface FillKillCase {
  readonly point: RunKillPoint;
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

async function crashFillOnce(killCase: FillKillCase): Promise<FillOutcome> {
  const world = worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, folders);
  const { from, machine } = install;
  const before = services.signatures();
  const first = await startEngine(install, true);
  const killed = armKill(world, first, killCase.point);
  const order = await goLiveAndOrder(install);
  await killed;
  const atKill = await atKillOf(chain, from, machine.folder);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const signedAtKill = services.signatures();
  const isMinedAfterResend = killCase.point !== "included";
  const settle = async () => settleOrderAndStop(install, order);
  const second = await restartWith(install, { isMinedAfterResend, fills: true, settle });
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    atKill,
    sends,
    isResent: sends.length > sendsAtKill,
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    signatures: {
      beforeKill: signedAtKill - before,
      afterRestart: services.signatures() - signedAtKill,
    },
    restartExit: await second.engine.program.exited,
    order: second.settled,
    ...(await fillsOf(machine.folder, order)),
    story: await storyOf(machine.folder, [first, second.engine]),
  };
}

const notSigned = { isRelayed: false, isOnChain: false, mined: 0, stored: [] };

// A stop before the fill's bytes are stored leaves nothing to send: recovery ends the fill
// unsigned, the order records the skip, and the next price fills it once. A stop anywhere after
// leaves one transaction, which recovery follows to its end and records on the order; the prices
// that fire meanwhile wait behind it. Either way one transaction reaches the chain, and the order
// records one fill.
const fillKillCases: readonly FillKillCase[] = [
  {
    point: "asked",
    atKill: notSigned,
    isResent: true,
    signatures: { beforeKill: 0, afterRestart: 1 },
    skips: ["fill_failed"],
  },
  {
    point: "signed",
    atKill: notSigned,
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 1 },
    skips: ["fill_failed"],
  },
  {
    point: "stored",
    atKill: { ...unrelayed, isRelayed: true, stored: ["signed"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
  {
    point: "sent",
    atKill: { ...unmined, stored: ["sent"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
  {
    point: "included",
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: false,
    signatures: { beforeKill: 1, afterRestart: 0 },
    skips: [],
  },
];

describe.each(fillKillCases)("an engine killed at $point during a live order fill", (killCase) => {
  it.each(runs)("sends one transaction and records one fill, run %i", async () => {
    const outcome = await crashFillOnce(killCase);
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    const hashes = [...new Set(outcome.sends.map(({ hash }) => hash))];
    const { order } = outcome;
    expect(outcome.atKill).toStrictEqual(killCase.atKill);
    expect(hashes).toHaveLength(1);
    expect(outcome.landed).toStrictEqual(hashes);
    expect([outcome.mined, outcome.unmined]).toStrictEqual([1, 0]);
    expect(outcome.isResent).toBe(killCase.isResent);
    expect(outcome.signatures).toStrictEqual(killCase.signatures);
    expect(outcome.restartExit).toBe(0);
    expect([order.state, order.fills]).toStrictEqual(["filled", 1]);
    const skips = killCase.skips.map((reason) => ({ outcome: "skipped", reason }));
    expect(outcome.rows).toStrictEqual([...skips, { outcome: "filled" }]);
    expect(outcome.filledHashes).toStrictEqual(hashes);
  });
});
