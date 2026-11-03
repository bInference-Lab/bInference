import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { baseMainnet, bsc } from "@binference/chains";
import { BinferenceError, type Id, type JsonValue } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import { type Address, getAddress, keccak256, stringToHex } from "viem";
import { beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import { z } from "zod";
import { storedInstall } from "../e2e/init-fixtures.js";
import { connectClient } from "../e2e/test-host.js";
import {
  type CrashAcross,
  crashBridgeAmount,
  crashSpokePool,
  crashUsdc,
  fundCrashUsdc,
  installCrashAcross,
} from "./crash-across.js";
import type { CrashContext } from "./crash-context.js";
import { useCrashHarness } from "./crash-harness.js";
import {
  crashIntentOnce,
  type IntentKillCase,
  type IntentRun,
  sentOnceOf,
  sentSummaryOf,
} from "./crash-intent-runs.js";
import { withStore } from "./crash-reads.js";
import type { CrashInstall, CrashWorld } from "./crash-runs.js";
import { crashBalanceSlot } from "./crash-token.js";

// Each run bridges 20 USDC from a fresh install's main wallet to an address saved for Base,
// through Across, as the owner does from the CLI: an exact approval, then the deposit. The test
// kills the engine outright at the run's point of the deposit, between its signature and its send,
// between the send and the receipt, once the receipt is stored, or as the engine first reads the
// delivery; a second engine on the same folder recovers, follows the bridge and books its
// delivery. Across's SpokePool stands in on the bare chain, and Across's API and Base answer on
// loopback. What reached the chain is counted by the test's relays and anvil, the signatures by
// the test's Privy, the delivery read from the store.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 47 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const held: { across?: CrashAcross; entry?: ProtocolId<"addressBook"> } = {};

beforeAll(async () => {
  const { chain, services } = harness.worldOf();
  const anvil = async (method: string, params: readonly JsonValue[]) => chain.call(method, params);
  held.across = await installCrashAcross(anvil);
  services.route("across", held.across.api);
  services.route("base", held.across.base);
});

function acrossOf(): CrashAcross {
  if (held.across === undefined) {
    throw new Error("Across was not installed.");
  }
  return held.across;
}

const baseRef = chainRefSchema.parse(baseMainnet.id);
const recipient: Address = getAddress(
  keccak256(stringToHex("binference crash base recipient")).slice(0, 42),
);
const hexSchema = z.string().regex(/^0x[0-9a-f]*$/u);

// The agent's limits add Across, as `binference limit set` does once its 24 hours passed; answers
// the venues they allow.
async function allowAcross(install: CrashInstall): Promise<readonly string[]> {
  return withStore(install.machine.folder, async (stores, signal) => {
    const [agent] = await stores.agents.list({ signal });
    const settings =
      agent === undefined ? undefined : await stores.agents.get(agent.id, { signal });
    if (settings === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    const { agentId, pending, changedAtMs, version, ...values } = settings.limits;
    const venues = [...values.venues, "across"];
    const change = {
      agentId,
      limits: { ...values, venues },
      atMs: changedAtMs,
      expectedVersion: version,
    };
    const set = await stores.agents.setLimits(change, { signal });
    if (!set.ok || pending !== undefined) {
      throw new BinferenceError({
        code: "crash.limits_unset",
        message: "The limits did not change.",
      });
    }
    return venues;
  });
}

// The wallet holds the 20 USDC it bridges. The owner lets the agent bridge through Across: its
// limits and, with the owner key, its wallet's ceiling, as `binference ceiling set` does; and saves
// the recipient for Base with the owner key, as `binference address add` does. The recipient holds
// no code there.
async function prepare(world: CrashWorld, install: CrashInstall): Promise<Address> {
  const anvil = async (method: string, params: readonly JsonValue[]) =>
    world.chain.call(method, params);
  await fundCrashUsdc(anvil, install.from, crashBridgeAmount);
  acrossOf().plainOnBase(recipient);
  const venues = await allowAcross(install);
  const [wallet] = (await storedInstall(install.machine)).facts.wallets;
  const client = await connectClient(install.machine);
  try {
    const call = { signal: AbortSignal.timeout(60_000) };
    const [agent] = (await client.call("engine/status", {}, call)).agents;
    if (agent === undefined || wallet === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    const ownerKey = install.machine.ownerKey.code;
    await client.call("ceiling/set", { wallet: wallet.id, changes: { venues }, ownerKey }, call);
    const args = { agent: agent.id, chain: baseRef, address: recipient, label: "Base", ownerKey };
    const saved = await client.call("address/add", args, call);
    held.entry = saved.entry;
  } finally {
    client.close();
  }
  return install.from;
}

// What the SpokePool holds of the crash chain's USDC: the deposits it took.
async function spokePoolUsdc(world: CrashWorld): Promise<bigint> {
  const slot = crashBalanceSlot(crashSpokePool);
  return BigInt(
    hexSchema.parse(await world.chain.call("eth_getStorageAt", [crashUsdc, slot, "latest"])),
  );
}

// The bridges the store holds delivered for the intent, by the fill its delivery read found.
async function deliveredOf(folder: string, intent: Id<"int">): Promise<number> {
  return withStore(folder, async (stores, signal) => {
    const row = await stores.bridges.get(intent, { signal });
    const isDelivered = row?.state === "delivered" && row.fillTx !== undefined;
    return isDelivered &&
      (await stores.bridges.settledBy(row.fillTx, { signal }))?.intentId === intent
      ? 1
      : 0;
  });
}

const bridge: IntentRun = {
  executions: 0,
  requestOf: (agent) => {
    if (held.entry === undefined) {
      throw new Error("The recipient was not saved.");
    }
    return {
      kind: "bridge",
      agent,
      reason: "Bridge USDC to the owner's address on Base",
      amount: {
        asset: assetRefSchema.parse(`${bsc.id}/erc20:${crashUsdc}`),
        base: crashBridgeAmount,
      },
      toChain: baseRef,
      to: { entry: held.entry },
    };
  },
  prepare,
  // The SpokePool takes the 20 USDC once, and the bridge is delivered once by Across's fill.
  effect: { read: spokePoolUsdc, moves: crashBridgeAmount },
  rows: { read: deliveredOf, landed: 1 },
};

const approved = { isRelayed: true, isOnChain: true, mined: 1 };
const deposited = { ...approved, mined: 2 };
const twoSigned = { step: 1, signatures: 2 } as const;

// A stop once the deposit is signed, before its bytes are stored, leaves the approval landed and
// nothing to send: recovery ends the bridge `step_unsent` and keeps the exact approval. A stop
// anywhere after leaves the deposit, which recovery follows to its end, then reads delivered on
// Base, its fill booked once.
const bridgeKillCases: readonly IntentKillCase[] = [
  {
    ...twoSigned,
    point: "signed",
    atKill: { ...approved, stored: ["included"] },
    state: "failed_onchain",
    sent: 1,
    isResent: false,
  },
  {
    ...twoSigned,
    point: "stored",
    atKill: { ...approved, stored: ["included", "signed"] },
    state: "reconciled",
    sent: 2,
    isResent: true,
  },
  {
    ...twoSigned,
    point: "sent",
    atKill: { ...approved, stored: ["included", "sent"] },
    state: "reconciled",
    sent: 2,
    isResent: true,
  },
  {
    ...twoSigned,
    point: "included",
    atKill: { ...deposited, stored: ["included", "sent"] },
    state: "reconciled",
    sent: 2,
    isResent: false,
  },
  {
    ...twoSigned,
    point: "receipt",
    atKill: { ...deposited, stored: ["included", "included"] },
    state: "reconciled",
    sent: 2,
    isResent: false,
  },
  // Once the deposit is final, the engine's follower asks Across where the bridge stands, every
  // 30 seconds; a stop as it asks first leaves the bridge in transit, which the restarted engine
  // reads delivered on Base and books once.
  {
    ...twoSigned,
    point: "delivery",
    reach: async () => acrossOf().holdNextStatus(),
    atKill: { ...deposited, stored: ["included", "included"] },
    state: "reconciled",
    sent: 2,
    isResent: false,
  },
];

describe.each(bridgeKillCases)(
  "an engine killed at $point of its deposit during a bridge through Across",
  (killCase) => {
    it.each(runs)("sends each step once and books the bridge once, run %i", async () => {
      const outcome = await crashIntentOnce(harness, bridge, killCase);
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      expect(sentSummaryOf(outcome)).toStrictEqual(sentOnceOf(killCase, bridge));
    });
  },
);
