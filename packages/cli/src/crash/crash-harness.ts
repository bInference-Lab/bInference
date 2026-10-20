import { join } from "node:path";
import { createSeededRandom } from "@binference/core/testing";
import { createFakePrivy } from "@binference/custody-privy/testing";
import { readLogLines } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import type { Address } from "viem";
import { afterAll, afterEach, beforeAll } from "vitest";
import type { SourceProgram } from "../e2e/source-program.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { type KillPoint, serveCrashChain } from "./crash-chain.js";
import type { CrashContext } from "./crash-context.js";
import { installCrashFlap } from "./crash-flap.js";
import { installCrashMarket } from "./crash-market.js";
import { type CrashInstall, type CrashWorld, startCrashEngine } from "./crash-runs.js";
import { serveCrashServices } from "./crash-services.js";

// One engine's whole run, from its start to its last intent's end.
const engineBudgetMs = 160_000;

/** Where a run kills the engine: a point of the chain's, or `asked`, as custody is asked to sign. */
export type RunKillPoint = KillPoint | "asked";

/** Where and on which send a run kills the engine. */
export interface RunKill {
  readonly point: RunKillPoint;
  /** The lowest nonce whose send a kill on the chain's side waits for; zero when absent. */
  readonly fromNonce?: number;
}

/** A crash test file's world and the engines and folders of its runs. */
export interface CrashHarness {
  readonly worldOf: () => CrashWorld;
  /** The state folders the file's runs made, removed after each run. */
  readonly folders: TempFolder[];
  /**
   * Starts an engine on the install, with the crash prices that fire live orders when `fills` and
   * a scripted agent runtime when `chat`, killed after the run if it still runs.
   */
  readonly startEngine: (
    install: CrashInstall,
    options?: { readonly fills?: boolean; readonly chat?: boolean },
  ) => Promise<SourceProgram>;
}

/**
 * Sets up a crash test file: the suite's one anvil chain behind the test's relays and RPC, Privy,
 * KyberSwap's, Flap's and Telegram's APIs on loopback, and the crash market and Flap, with wallet
 * keys drawn from the file's own seed; after each run, the engines that still run are killed and
 * the run's folders removed.
 */
export function useCrashHarness(
  crash: CrashContext,
  file: { readonly seed: number },
): CrashHarness {
  const folders: TempFolder[] = [];
  const programs: SourceProgram[] = [];
  const held: { world?: CrashWorld } = {};
  beforeAll(async () => {
    const chain = await serveCrashChain(crash.rpcUrl);
    // One random for every app, so no two runs' apps make the same wallet key, and a seed of each
    // file's own, since every file's runs share the one chain.
    const random = createSeededRandom(file.seed);
    const newPrivyApp = () => createFakePrivy({ clock: createSystemClock(), random });
    const services = await serveCrashServices();
    await installCrashMarket(async (method, params) => chain.call(method, params));
    await installCrashFlap(async (method, params) => chain.call(method, params));
    held.world = { chain, services, newPrivyApp };
  });
  afterEach(async () => {
    held.world?.chain.stopKilling();
    held.world?.chain.acceptSends();
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
  const worldOf = (): CrashWorld => {
    if (held.world === undefined) {
      throw new Error("The crash chain did not start.");
    }
    return held.world;
  };
  return {
    worldOf,
    folders,
    startEngine: async (install, options = {}) => {
      const signal = AbortSignal.timeout(engineBudgetMs);
      const run = { signal, fills: options.fills === true, chat: options.chat === true };
      const engine = await startCrashEngine(worldOf(), install, run);
      programs.push(engine);
      return engine;
    },
  };
}

/** What a run did, for a failure's message: its engines' reports and the engine log. */
export async function storyOf(folder: string, engines: readonly SourceProgram[]): Promise<string> {
  const log = await readLogLines(join(folder, "logs", "engine.log"), {
    maxBytes: 200_000,
    signal: AbortSignal.timeout(10_000),
  });
  const logLines = log.ok ? log.value.lines : [];
  return [...engines.map((engine) => engine.lines().join("\n")), ...logLines].join("\n");
}

/** Kills the engine outright, and tells whether the test killed it. */
export function killerOf(engine: SourceProgram): {
  readonly state: { isKilled: boolean };
  readonly kill: () => Promise<void>;
} {
  const state = { isKilled: false };
  const kill = async (): Promise<void> => {
    state.isKilled = true;
    engine.program.kill();
    await engine.program.exited;
  };
  return { state, kill };
}

function isChainPoint(point: RunKillPoint): point is Exclude<KillPoint, "signed"> {
  return point !== "asked" && point !== "signed";
}

/**
 * Runs `kill` once the engine reached the point, and settles once it ran: custody asked to sign,
 * before it signs (`asked`), custody signed and holds its answer (`signed`), or the chain's side
 * saw the point on the send of the nonce the kill waits for.
 */
export async function killWhenReached(
  world: CrashWorld,
  at: RunKill,
  kill: () => Promise<void>,
): Promise<void> {
  const { point } = at;
  if (!isChainPoint(point)) {
    const held =
      point === "asked" ? world.services.holdNextRequest() : world.services.holdNextSignature();
    return held.then(kill);
  }
  return new Promise((resolve) => {
    const killed = async (): Promise<void> => {
      await kill();
      resolve();
    };
    world.chain.killAt(
      point,
      killed,
      at.fromNonce === undefined ? {} : { fromNonce: at.fromNonce },
    );
  });
}

/**
 * Arms a kill that `reach` runs once the engine got to the point it names, and resolves once the
 * engine is dead; an engine that ends by itself first fails the run.
 */
export async function armKillWith(
  engine: SourceProgram,
  point: string,
  reach: (kill: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const { state, kill } = killerOf(engine);
  const ended = (async () => {
    await engine.program.exited;
    if (!state.isKilled) {
      throw new Error(`The engine ended before ${point}:\n${engine.lines().join("\n")}`);
    }
  })();
  await Promise.all([reach(kill), ended]);
}

/**
 * Arms the kill at a point of the money path and resolves once the engine is dead; an engine that
 * ends by itself first fails the run.
 */
export async function armKill(
  world: CrashWorld,
  engine: SourceProgram,
  at: RunKill,
): Promise<void> {
  return armKillWith(engine, at.point, async (kill) => killWhenReached(world, at, kill));
}

/**
 * Starts the engine again with blocks mined, as BSC moves on, waits until `settle` settles, and
 * waits for the engine to stop. A run whose transaction should still be unmined when recovery
 * reads the chain mines only once the relays get the recovering engine's send.
 */
export async function restartWith<T>(
  harness: CrashHarness,
  install: CrashInstall,
  run: {
    readonly isMinedAfterResend: boolean;
    readonly fills: boolean;
    readonly chat?: boolean;
    readonly settle: () => Promise<T>;
    /** The wallet whose send the mining waits for; the install's own when absent. */
    readonly from?: Address;
  },
): Promise<{ readonly engine: SourceProgram; readonly settled: T }> {
  const { chain } = harness.worldOf();
  const miner = new AbortController();
  const stopped = new Promise<void>((resolve) => {
    miner.signal.addEventListener("abort", () => resolve());
  });
  const resent = Promise.race([chain.nextSend(run.from ?? install.from), stopped]);
  const start = run.isMinedAfterResend ? resent : Promise.resolve();
  const mining = start.then(async () => chain.mine(miner.signal));
  try {
    const engine = await harness.startEngine(install, {
      fills: run.fills,
      chat: run.chat === true,
    });
    const settled = await run.settle();
    await engine.program.exited;
    return { engine, settled };
  } finally {
    miner.abort();
    await mining;
  }
}
