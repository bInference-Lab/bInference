import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { baseMainnet, bsc } from "@binference/chains";
import { BinferenceError, type Id } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import { type Address, getAddress, keccak256, stringToHex } from "viem";
import { z } from "zod";
import { connectClient } from "../e2e/test-host.js";
import { crashBridgeAmount, crashUsdc } from "./crash-across.js";
import type { IntentKillCase } from "./crash-intent-runs.js";
import { withStore } from "./crash-reads.js";
import type { CrashInstall, CrashRequestOf, CrashWorld } from "./crash-runs.js";
import { crashBalanceSlot } from "./crash-token.js";

/** Base, where every crash bridge delivers. */
const baseRef = chainRefSchema.parse(baseMainnet.id);

/** The owner's address on Base that every crash bridge pays, a person's wallet there. */
export const crashBaseRecipient: Address = getAddress(
  keccak256(stringToHex("binference crash base recipient")).slice(0, 42),
);

const hexSchema = z.string().regex(/^0x[0-9a-f]*$/u);

/**
 * The agent's limits add the venue, as `binference limit set` does once its 24 hours passed;
 * answers the venues they allow.
 */
export async function allowVenue(install: CrashInstall, venue: string): Promise<readonly string[]> {
  return withStore(install.machine.folder, async (stores, signal) => {
    const [agent] = await stores.agents.list({ signal });
    const settings =
      agent === undefined ? undefined : await stores.agents.get(agent.id, { signal });
    if (settings === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    const { agentId, pending, changedAtMs, version, ...values } = settings.limits;
    const venues = [...values.venues, venue];
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

/** What the owner does over IPC to let the install bridge, with the owner key. */
export interface BridgeSetup {
  readonly agent: ProtocolId<"agent">;
  readonly ownerKey: string;
  readonly call: { readonly signal: AbortSignal };
  readonly client: Awaited<ReturnType<typeof connectClient>>;
}

/**
 * Runs `steps` as the owner over the install's IPC, then saves the recipient for Base with the
 * owner key, as `binference address add` does; answers the entry.
 */
export async function savedForBase(
  install: CrashInstall,
  steps: (setup: BridgeSetup) => Promise<void>,
): Promise<ProtocolId<"addressBook">> {
  const client = await connectClient(install.machine);
  try {
    const call = { signal: AbortSignal.timeout(60_000) };
    const [agent] = (await client.call("engine/status", {}, call)).agents;
    if (agent === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    const ownerKey = install.machine.ownerKey.code;
    await steps({ agent: agent.id, ownerKey, call, client });
    const args = { agent: agent.id, chain: baseRef, address: crashBaseRecipient, label: "Base" };
    return (await client.call("address/add", { ...args, ownerKey }, call)).entry;
  } finally {
    client.close();
  }
}

/** A bridge of the crash bridge amount of BSC USDC to the saved entry on Base. */
export function bridgeToBase(entry: () => ProtocolId<"addressBook"> | undefined): CrashRequestOf {
  return (agent) => {
    const to = entry();
    if (to === undefined) {
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
      to: { entry: to },
    };
  };
}

/** What the holder holds of the crash chain's USDC. */
export async function usdcHeldBy(world: CrashWorld, holder: Address): Promise<bigint> {
  const slot = crashBalanceSlot(holder);
  return BigInt(
    hexSchema.parse(await world.chain.call("eth_getStorageAt", [crashUsdc, slot, "latest"])),
  );
}

/** The bridges the store holds delivered for the intent, by the fill its delivery read found. */
export async function deliveredOf(folder: string, intent: Id<"int">): Promise<number> {
  return withStore(folder, async (stores, signal) => {
    const row = await stores.bridges.get(intent, { signal });
    const isDelivered = row?.state === "delivered" && row.fillTx !== undefined;
    return isDelivered &&
      (await stores.bridges.settledBy(row.fillTx, { signal }))?.intentId === intent
      ? 1
      : 0;
  });
}

const approved = { isRelayed: true, isOnChain: true, mined: 1 };
const deposited = { ...approved, mined: 2 };
const twoSigned = { step: 1, signatures: 2 } as const;

/**
 * The kill points of a bridge's deposit, the step after its exact approval, and of its first
 * delivery read, which `reach` waits for. A stop once the deposit is signed, before its bytes are
 * stored, leaves the approval landed and nothing to send: recovery ends the bridge `step_unsent`
 * and keeps the exact approval. A stop anywhere after leaves the deposit, which recovery follows
 * to its end, then reads delivered on Base, its fill booked once.
 */
export function bridgeKillCases(reach: () => Promise<void>): readonly IntentKillCase[] {
  const toEnd = { ...twoSigned, state: "reconciled", sent: 2 } as const;
  return [
    {
      ...twoSigned,
      point: "signed",
      atKill: { ...approved, stored: ["included"] },
      state: "failed_onchain",
      sent: 1,
      isResent: false,
    },
    {
      ...toEnd,
      point: "stored",
      atKill: { ...approved, stored: ["included", "signed"] },
      isResent: true,
    },
    {
      ...toEnd,
      point: "sent",
      atKill: { ...approved, stored: ["included", "sent"] },
      isResent: true,
    },
    {
      ...toEnd,
      point: "included",
      atKill: { ...deposited, stored: ["included", "sent"] },
      isResent: false,
    },
    {
      ...toEnd,
      point: "receipt",
      atKill: { ...deposited, stored: ["included", "included"] },
      isResent: false,
    },
    // Once the deposit is final, the engine's follower asks the bridge where it stands, every 30
    // seconds; a stop as it asks first leaves the bridge in transit.
    {
      ...toEnd,
      point: "delivery",
      reach,
      atKill: { ...deposited, stored: ["included", "included"] },
      isResent: false,
    },
  ];
}
