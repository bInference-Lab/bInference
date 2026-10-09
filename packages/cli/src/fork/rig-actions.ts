import { setTimeout as wait } from "node:timers/promises";
import type { AssetRef } from "@binference/chain";
import type { Fork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import { erc20Abi } from "viem";
import { agent, buyIn, type Rig, usdt, wallet, walletKey } from "./executor-rig.js";
import { forkWallet } from "./fork-trading.js";

const caller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000043",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm"],
} as const;

/** The swap a fork test proposes: what goes in, how much, and what comes out. */
export interface ForkSwap {
  readonly from: AssetRef;
  readonly to: AssetRef;
  readonly base: bigint;
}

/** Proposes a swap as the CLI would and taps Confirm on its card; answers the intent. */
export async function proposeAndTap(
  rig: Rig,
  signal: AbortSignal,
  swap: ForkSwap = { from: rig.native, to: rig.bought, base: buyIn },
): Promise<Id<"int">> {
  const handlers = rig.engine.handlers;
  const request = {
    kind: "swap",
    agent,
    wallet,
    reason: "Trade USDT on the fork",
    from: swap.from,
    to: swap.to,
    amount: { base: swap.base },
  } as const;
  const proposed = await handlers["intent/propose"]({ args: request, caller, signal });
  const card = proposed.ok ? proposed.value.card : undefined;
  if (!proposed.ok || card === undefined) {
    const details = proposed.ok ? { state: proposed.value.state } : { errorCode: proposed.error };
    throw new BinferenceError({
      code: "fork.no_card",
      message: "The swap opened no card.",
      details,
    });
  }
  const { intent } = proposed.value;
  const args = { intent, card: card.card, cardVersion: 1 };
  const confirmed = await handlers["intent/confirm"]({ args, caller, signal });
  if (!confirmed.ok) {
    const details = { errorCode: confirmed.error };
    throw new BinferenceError({ code: "fork.not_confirmed", message: "No tap.", details });
  }
  return intent;
}

/** Waits until the intent reaches the state, polling the store, for at most a minute. */
export async function reach(rig: Rig, intent: Id<"int">, state: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  const poll = async (): Promise<string> => {
    const record = await rig.stores.intents.get(intent, { signal: AbortSignal.timeout(5_000) });
    if (record?.state === state || Date.now() > deadline) {
      return record?.state ?? "missing";
    }
    await wait(200);
    return poll();
  };
  return poll();
}

/** The test wallet's USDT on the fork. */
export async function balanceOf(fork: Fork): Promise<bigint> {
  return fork.client.readContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [forkWallet(walletKey).address],
  });
}
