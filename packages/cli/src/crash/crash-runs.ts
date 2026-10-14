import { EventEmitter } from "node:events";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError, bpsSchema, type Id } from "@binference/core";
import type { FakePrivy } from "@binference/custody-privy/testing";
import { readTextFile, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { ProtocolId } from "@binference/protocol";
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
import { crashUsdt, freshCrashFeeds, fundCrashUsdt } from "./crash-market.js";
import { crashUsdtAsset } from "./crash-orders.js";
import type { CrashServices } from "./crash-services.js";

/** What every crash run shares: the chain with its relays, Privy and KyberSwap's API. */
export interface CrashWorld {
  readonly chain: CrashChain;
  readonly services: CrashServices;
  /** Makes a new fake Privy app, as each owner creates one for an install. */
  readonly newPrivyApp: () => FakePrivy;
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
 * Sets up one run's state folder as an owner does: `binference init` against a new Privy app the
 * services now serve, with BSC's RPC and relays pointed at the test's chain, and the wallet it made
 * funded with 1 BNB. The feeds get a fresh round, as a run outlasts the BNB feed's heartbeat.
 */
export async function setUpCrashInstall(
  world: CrashWorld,
  folders: TempFolder[],
): Promise<CrashInstall> {
  const folder = await createTempFolder("bnf-crash-");
  folders.push(folder);
  const privy = world.newPrivyApp();
  world.services.serve(privy);
  const machine = machineOf({
    folder: folder.path,
    clock: createSystemClock(),
    signals: new EventEmitter(),
    privy: { ...privy, sent: [] },
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
  run: { readonly signal: AbortSignal; readonly fills?: boolean },
): Promise<SourceProgram> {
  const { signal } = run;
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
      ...(run.fills === true ? { CRASH_FILLS: "1" } : {}),
      ...secretEnv(install.machine),
    },
    signal,
  });
  await engine.lineWith('"state":');
  return engine;
}

// The install's one agent, gone live as `binference live` does.
async function goneLive(client: ProtocolClient, call: { readonly signal: AbortSignal }) {
  const [agent] = (await client.call("engine/status", {}, call)).agents;
  if (agent === undefined) {
    throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
  }
  await client.call("agent/goLive", { agent: agent.id }, call);
  return agent;
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
    const agent = await goneLive(client, call);
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

/** The live order a fill run makes: a one-fill buy of USDT, or a sale of all of it. */
export type CrashOrderKind = "buy" | "sale";

/** The USDT a sale run's wallet holds before its order: six dollars of it. */
const crashSaleUsdt: bigint = 6n * 10n ** 18n;

// The order of a run's kind: a limit buy of USDT with 0.01 BNB while it is at or below $2, or a
// stop-loss that sells all the wallet's USDT once it falls to $2.
function orderRequestOf(kind: CrashOrderKind, agent: ProtocolId<"agent">) {
  return kind === "buy"
    ? ({
        kind: "limit",
        agent,
        reason: "Buy USDT on the crash chain once it is at or below $2",
        token: crashUsdtAsset,
        side: "buy",
        spend: assetRefSchema.parse(`${bscRef}/slip44:714`),
        size: { base: spend },
        trigger: { price: 2_000_000n, direction: "below" },
        maxFills: 1,
      } as const)
    : ({
        kind: "stopLoss",
        agent,
        reason: "Sell the USDT on the crash chain once it falls to $2",
        token: crashUsdtAsset,
        side: "sell",
        size: { percentBps: bpsSchema.parse(10_000) },
        trigger: { price: 2_000_000n },
      } as const);
}

/**
 * Goes live as `binference live` does and makes a live order of `kind`, then taps Confirm on its
 * card; answers the order. A sale's wallet holds six dollars of USDT first. The crash engine's
 * prices hold USDT at $1, so the order fires at the next block, and at every block after while it
 * is active.
 */
export async function goLiveAndOrder(
  world: CrashWorld,
  install: CrashInstall,
  kind: CrashOrderKind = "buy",
): Promise<ProtocolId<"autoOrder">> {
  if (kind === "sale") {
    await fundCrashUsdt(
      async (method, params) => world.chain.call(method, params),
      install.from,
      crashSaleUsdt,
    );
  }
  const client = await connectClient(install.machine);
  const call = { signal: AbortSignal.timeout(60_000) };
  try {
    const agent = await goneLive(client, call);
    const request = orderRequestOf(kind, agent.id);
    const created = await client.call("order/create", request, call);
    const { card, intent } = created;
    if (card === undefined || intent === undefined) {
      throw new BinferenceError({ code: "crash.no_card", message: `No card: ${created.state}.` });
    }
    await client.call("intent/confirm", { intent, card, cardVersion: 1 }, call);
    return created.order;
  } finally {
    client.close();
  }
}

/** Where a run's order stands once the restarted engine settled it. */
export interface SettledOrder {
  readonly state: string;
  readonly fills: number;
}

const settledOrders = new Set(["filled", "cancelled", "expired", "ended"]);

/**
 * Waits on the running engine until the order has ended, as its one fill settled, then stops the
 * engine through `engine/stop`; answers where the order stands.
 */
export async function settleOrderAndStop(
  install: CrashInstall,
  order: ProtocolId<"autoOrder">,
): Promise<SettledOrder> {
  const client = await connectClient(install.machine);
  const deadline = Date.now() + 120_000;
  try {
    const poll = async (): Promise<SettledOrder> => {
      const view = await client.call(
        "order/get",
        { order },
        { signal: AbortSignal.timeout(10_000) },
      );
      if (settledOrders.has(view.state) || Date.now() > deadline) {
        return { state: view.state, fills: view.fills };
      }
      await wait(200);
      return poll();
    };
    const settled = await poll();
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
    return settled;
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

/**
 * Waits on the running engine until a live fill ended `failed_onchain`, as the drop rule ends one
 * every relay refused; answers it. A minute without one fails the run.
 */
export async function droppedFillOf(install: CrashInstall): Promise<Id<"int">> {
  const client = await connectClient(install.machine);
  const deadline = Date.now() + 60_000;
  try {
    const poll = async (): Promise<Id<"int">> => {
      const page = await client.call(
        "intent/list",
        { state: "failed_onchain", limit: 5 },
        { signal: AbortSignal.timeout(10_000) },
      );
      const [dropped] = page.items;
      if (dropped !== undefined) {
        return dropped.intent;
      }
      if (Date.now() > deadline) {
        throw new BinferenceError({ code: "crash.no_drop", message: "No fill was dropped." });
      }
      await wait(200);
      return poll();
    };
    return await poll();
  } finally {
    client.close();
  }
}
