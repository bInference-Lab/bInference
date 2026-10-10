import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { readLogLines } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { createSqliteTransactionStore, engineWorker, openDatabase } from "@binference/store";
import { type Address, type Hex, toHex } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import { z } from "zod";
import { type SourceProgram, startSourceProgram } from "../e2e/source-program.js";
import { writeTestConfig } from "../e2e/test-host.js";
import { forkWallet } from "../fork/fork-trading.js";
import {
  type CrashChain,
  type KillPoint,
  type RelayedSend,
  serveCrashChain,
} from "./crash-chain.js";
import type { CrashContext } from "./crash-context.js";
import { type CrashEvent, crashEventSchema } from "./crash-engine.schema.js";
import { crashRelays } from "./crash-http.js";
import { crashWalletKey } from "./crash-wallet.js";

// Each run trades from a wallet of its own on the suite's one anvil chain: the first engine
// proposes a swap, the owner confirms it, and the test kills the engine outright at the run's
// kill point (SIGKILL, or TerminateProcess on Windows, through the platform's program); a second
// engine on the same state folder then recovers. What reached the chain is counted by the test's
// relays and by anvil itself, never taken from the engine.
const crash: CrashContext = inject("crash");
const engineFile = fileURLToPath(new URL("./crash-engine.ts", import.meta.url));
// One engine's whole run, from its start to its last intent's end.
const engineBudgetMs = 160_000;
const folders: TempFolder[] = [];
const programs: SourceProgram[] = [];
const held: { chain?: CrashChain } = {};

beforeAll(async () => {
  held.chain = await serveCrashChain(crash.rpcUrl);
});

afterEach(async () => {
  held.chain?.stopKilling();
  await Promise.all(
    programs.splice(0).map(async ({ program }) => {
      program.kill();
      await program.exited;
    }),
  );
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

afterAll(async () => {
  await held.chain?.close();
});

function chainOf(): CrashChain {
  if (held.chain === undefined) {
    throw new Error("The crash chain did not start.");
  }
  return held.chain;
}

// A fresh state folder whose config points BSC's RPC and relays at the test's chain.
async function newFolder(chain: CrashChain): Promise<string> {
  const folder = await createTempFolder("bnf-crash-");
  folders.push(folder);
  const chains = {
    rpc: { [bsc.id]: { urls: [chain.rpcUrl] } },
    relays: { [bsc.id]: crashRelays },
    maxFeePerGasGwei: { [bsc.id]: "10" },
  };
  await writeTestConfig(folder.path, `  chains: ${JSON.stringify(chains)},\n`);
  return folder.path;
}

function startEngine(
  folder: string,
  run: { readonly wallet: string; readonly isHolding: boolean },
) {
  const engine = startSourceProgram({
    file: engineFile,
    args: [],
    parentEnv: process.env,
    env: {
      BINFERENCE_HOME: folder,
      LANG: "en_US.UTF-8",
      CRASH_WALLET: run.wallet,
      CRASH_RELAYS: chainOf().relays,
      ...(run.isHolding ? { CRASH_HOLD: "signed" } : {}),
    },
    signal: AbortSignal.timeout(engineBudgetMs),
  });
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

async function killWhenHolding(engine: SourceProgram, kill: () => Promise<void>): Promise<void> {
  const line = await engine.lineWith('"event":"holding"');
  if (!line.includes('"event":"holding"')) {
    throw new Error(`Custody never held after signing:\n${line}`);
  }
  await kill();
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

// Kills the engine at the point: `signed` once custody reports it holds after signing, every
// other point once the test's chain sees the engine reach it. An engine that ends by itself
// first fails the run.
async function killAt(chain: CrashChain, engine: SourceProgram, point: KillPoint): Promise<void> {
  const { state, kill } = killerOf(engine);
  const ended = (async () => {
    await engine.program.exited;
    if (!state.isKilled) {
      throw new Error(`The engine ended before ${point}:\n${engine.lines().join("\n")}`);
    }
  })();
  const killed =
    point === "signed" ? killWhenHolding(engine, kill) : killOnChain(chain, point, kill);
  await Promise.all([killed, ended]);
}

// Starts the engine again with blocks mined, as BSC moves on, and waits until it has recovered
// and every intent has ended. A run whose transaction should still be unmined when recovery reads
// the chain mines only once the relays get the recovering engine's send.
async function restart(
  chain: CrashChain,
  folder: string,
  run: { readonly wallet: string; readonly from: Address; readonly isMinedAfterResend: boolean },
): Promise<SourceProgram> {
  const miner = new AbortController();
  const stopped = new Promise<void>((resolve) => {
    miner.signal.addEventListener("abort", () => resolve());
  });
  const resent = Promise.race([chain.nextSend(run.from), stopped]);
  const start = run.isMinedAfterResend ? resent : Promise.resolve();
  const mining = start.then(async () => chain.mine(miner.signal));
  const engine = startEngine(folder, { wallet: run.wallet, isHolding: false });
  try {
    await engine.program.exited;
  } finally {
    miner.abort();
    await mining;
  }
  return engine;
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

// What the killed engine's store holds: what survived the kill, read as the next engine reads it.
async function storedOf(folder: string, from: Address): Promise<readonly string[]> {
  const signal = AbortSignal.timeout(30_000);
  const database = await openDatabase({
    file: join(folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: storeExecArgv,
    signal,
  });
  try {
    const account = evmAccountRef(evmChainOf(bsc), from);
    const query = { account, fromNonce: 0, limit: 10 };
    const stored = await createSqliteTransactionStore(database).list(query, { signal });
    return stored.map(({ state }) => state);
  } finally {
    await database.close();
  }
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
  /** The restarted engine's report of the run's intent once it ended. */
  readonly settled: CrashEvent | undefined;
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

function signaturesOf(engine: SourceProgram): number {
  return engine.lines().filter((line) => line.includes('"event":"signed"')).length;
}

function settledOf(engine: SourceProgram): CrashEvent | undefined {
  const line = engine.lines().find((text) => text.includes('"event":"settled"'));
  return line === undefined ? undefined : crashEventSchema.parse(JSON.parse(line));
}

/** One run as it went: its wallet, its folder, both engines and what held at the kill. */
interface CrashRun {
  readonly from: Address;
  readonly folder: string;
  readonly first: SourceProgram;
  readonly second: SourceProgram;
  readonly atKill: AtKill;
  /** How many sends the relays had received from the wallet when the engine died. */
  readonly sendsAtKill: number;
}

async function outcomeOf(chain: CrashChain, run: CrashRun): Promise<RunOutcome> {
  const { from, first, second } = run;
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    atKill: run.atKill,
    sends,
    isResent: sends.length > run.sendsAtKill,
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    signatures: { beforeKill: signaturesOf(first), afterRestart: signaturesOf(second) },
    restartExit: await second.program.exited,
    settled: settledOf(second),
    story: await storyOf(run.folder, [first, second]),
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

async function crashOnce(killCase: KillCase, run: number): Promise<RunOutcome> {
  const chain = chainOf();
  const { point, isResent } = killCase;
  const wallet = `${point}-${String(run)}`;
  const from = forkWallet(crashWalletKey(wallet)).address;
  await chain.call("anvil_setBalance", [from, toHex(10n ** 18n)]);
  const folder = await newFolder(chain);
  const first = startEngine(folder, { wallet, isHolding: point === "signed" });
  await killAt(chain, first, point);
  const atKill = await atKillOf(chain, from, folder);
  const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
  const second = await restart(chain, folder, { wallet, from, isMinedAfterResend: isResent });
  return outcomeOf(chain, { from, folder, first, second, atKill, sendsAtKill });
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
  it.each(runs)("sends one transaction at most, run %i", async (run) => {
    const outcome = await crashOnce(killCase, run);
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
    expect(outcome.settled).toMatchObject({ event: "settled", state: killCase.state, hashes });
  });
});
