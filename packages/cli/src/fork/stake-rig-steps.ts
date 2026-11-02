import type { Fork } from "@binference/chain-evm/fork";
import { BinferenceError } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { toHex } from "viem";
import { expect } from "vitest";
import type { RescueRig } from "./rescue-rig.js";
import { cardTextOf, confirmOn, endedStates, proposeOn, reachOn } from "./rig-calls.js";

const bnb = 10n ** 18n;

/** The agent's main wallet on the rig, with no code and 3 BNB on the fork. */
export async function fundedMain(
  fork: Fork,
  rig: RescueRig,
): Promise<RescueRig["wallets"][number]> {
  const [main] = rig.wallets;
  if (main === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "The rig has no wallet." });
  }
  await fork.call("anvil_setCode", [main.address, "0x"]);
  await fork.call("anvil_setBalance", [main.address, toHex(3n * bnb)]);
  return main;
}

/**
 * Proposes the move, which must open a card, taps it, and answers its view, its card's lines and
 * the state it settled in.
 */
export async function tappedOn(
  rig: RescueRig,
  request: IntentRequest,
  signal: AbortSignal,
): Promise<{
  readonly view: IntentView;
  readonly lines: readonly string[];
  readonly state: string;
}> {
  const view = await proposeOn(rig, request, signal);
  expect([view.state, view.outcome?.reason]).toStrictEqual(["awaiting_confirmation", undefined]);
  const lines = await cardTextOf(rig, view, signal);
  await confirmOn(rig, view, signal);
  return { view, lines, state: await reachOn(rig, view.intent, endedStates) };
}
