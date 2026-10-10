import { EventEmitter } from "node:events";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { BinferenceError, type Id } from "@binference/core";
import type { FakePrivy } from "@binference/custody-privy/testing";
import { readTextFile, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { type Address, getAddress, toHex } from "viem";
import {
  type InitMachine,
  initFlags,
  runOn,
  secretEnv,
  machineOf,
  storedInstall,
} from "../e2e/init-fixtures.js";
import { type SourceProgram, startSourceProgram } from "../e2e/source-program.js";
import { connectClient, freePort, noPermissions } from "../e2e/test-host.js";
import { createSystemClock } from "../runtime/system-clock.js";
import type { CrashChain } from "./crash-chain.js";
import { crashRelays } from "./crash-http.js";
import { crashUsdt, freshCrashFeeds } from "./crash-market.js";
import type { CrashServices } from "./crash-services.js";

/** What every crash run shares: the chain with its relays, Privy and KyberSwap's API. */
export interface CrashWorld {
  readonly chain: CrashChain;
  readonly services: CrashServices;
  readonly privy: FakePrivy;
}

/** One run's install: its state folder set up by `binference init`, and its funded wallet. */
export interface CrashInstall {
  readonly machine: InitMachine;
  readonly from: Address;
}

const engineFile = fileURLToPath(new URL("./crash-engine.ts", import.meta.url));
const bscRef = chainRefSchema.parse(bsc.id);
const spend = 10n ** 16n;

// BSC's RPC and relays point at the test's chain; the fee cap leaves room for anvil's fees.
async function pointAtChain(machine: InitMachine, chain: CrashChain): Promise<void> {
  const file = join(machine.folder, "config.json5");
  const read = await readTextFile(file, AbortSignal.timeout(5_000));
  if (!read.ok) {
    throw new BinferenceError({ code: "crash.no_config", message: "init wrote no config." });
  }
  const chains = {
    rpc: { [bsc.id]: { urls: [chain.rpcUrl] } },
    relays: { [bsc.id]: crashRelays },
    maxFeePerGasGwei: { [bsc.id]: "10" },
  };
  const text = read.value.replace("{", `{\n  chains: ${JSON.stringify(chains)},`);
  const files = { permissions: noPermissions, signal: AbortSignal.timeout(5_000) };
  await writePrivateFile(file, text, files);
}

/**
 * Sets up one run's state folder as an owner does: `binference init` against the suite's Privy,
 * with BSC's RPC and relays pointed at the test's chain, and the wallet it made funded with 1 BNB.
 * The feeds get a fresh round, as a run outlasts the BNB feed's heartbeat.
 */
export async function setUpCrashInstall(
  world: CrashWorld,
  folders: TempFolder[],
): Promise<CrashInstall> {
  const folder = await createTempFolder("bnf-crash-");
  folders.push(folder);
  const machine = machineOf({
    folder: folder.path,
    clock: createSystemClock(),
    signals: new EventEmitter(),
    privy: { ...world.privy, sent: [] },
  });
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  if (init.code !== 0) {
    throw new BinferenceError({ code: "crash.init_failed", message: init.stderr });
  }
  await pointAtChain(machine, world.chain);
  const [wallet] = (await storedInstall(machine)).facts.wallets;
  if (wallet === undefined) {
    throw new BinferenceError({ code: "crash.no_wallet", message: "init made no wallet." });
  }
  const from = getAddress(wallet.address);
  await world.chain.call("anvil_setBalance", [from, toHex(10n ** 18n)]);
  await freshCrashFeeds(async (method, params) => world.chain.call(method, params));
  return { machine, from };
}

/**
 * Starts `binference start --foreground` on the install as a program of its own, and resolves
 * once it reported its state; an engine that ends first resolves too, its output then holding why.
 */
export async function startCrashEngine(
  world: CrashWorld,
  install: CrashInstall,
  signal: AbortSignal,
): Promise<SourceProgram> {
  const engine = startSourceProgram({
    file: engineFile,
    args: [],
    parentEnv: process.env,
    env: {
      BINFERENCE_HOME: install.machine.folder,
      LANG: "en_US.UTF-8",
      CRASH_RELAYS: world.chain.relays,
      CRASH_SERVICES: world.services.origin,
      CRASH_PORT: String(await freePort()),
      ...secretEnv(install.machine),
    },
    signal,
  });
  await engine.lineWith('"state":');
  return engine;
}

/**
 * Goes live as `binference live` does and proposes a swap of 0.01 BNB for USDT as the CLI would,
 * then taps Confirm on its card; answers the intent. The engine signs and sends it from there, so
 * a kill may cut the confirmation's answer off.
 */
export async function goLiveAndBuy(install: CrashInstall): Promise<Id<"int">> {
  const client = await connectClient(install.machine);
  const call = { signal: AbortSignal.timeout(60_000) };
  try {
    const [agent] = (await client.call("engine/status", {}, call)).agents;
    if (agent === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    await client.call("agent/goLive", { agent: agent.id }, call);
    const request = {
      kind: "swap",
      agent: agent.id,
      reason: "Buy USDT on the crash chain",
      from: assetRefSchema.parse(`${bscRef}/slip44:714`),
      to: assetRefSchema.parse(`${bscRef}/erc20:${crashUsdt}`),
      amount: { base: spend },
    } as const;
    const proposed = await client.call("intent/propose", request, call);
    const { card } = proposed;
    if (card === undefined) {
      const reason = proposed.outcome?.reason ?? proposed.state;
      throw new BinferenceError({ code: "crash.no_card", message: `No card: ${reason}.` });
    }
    const tap = { intent: proposed.intent, card: card.card, cardVersion: card.version };
    // A kill right after the signature can cut the confirmation's answer off; the intent is known.
    await client.call("intent/confirm", tap, call).catch(() => undefined);
    return proposed.intent;
  } finally {
    client.close();
  }
}

const ended = new Set(["reconciled", "cancelled", "failed_onchain", "expired", "denied"]);

/**
 * Waits on the running engine until the intent has ended, then stops the engine through
 * `engine/stop`; answers the intent's end.
 */
export async function settleAndStop(install: CrashInstall, intent: Id<"int">): Promise<string> {
  const client = await connectClient(install.machine);
  const deadline = Date.now() + 120_000;
  try {
    const poll = async (): Promise<string> => {
      const view = await client.call(
        "intent/get",
        { intent },
        { signal: AbortSignal.timeout(10_000) },
      );
      if (ended.has(view.state) || Date.now() > deadline) {
        return view.state;
      }
      await wait(200);
      return poll();
    };
    const state = await poll();
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
    return state;
  } finally {
    client.close();
  }
}
