import { setTimeout as wait } from "node:timers/promises";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { type Address, erc20Abi } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignerBundle, type SignerBundle } from "../compose/test-signer-bundle.js";
import { startMining } from "./executor-rig.js";
import { type ForkLaunch, launchOnGeniusfun } from "./geniusfun-launch.js";
import { type LaunchRig, launchRigOf, rigFunding, rigOwner } from "./launch-wallet-rig.js";
import { heldOn } from "./rescue-rig.js";

// Curve trades from an agent's launch wallet (decision 0217) on a BSC fork: a token launched on
// Genius.fun's m4.2 stack a moment before, on a curve no list holds, bought and sold through the
// real executor, the signer process as a release builds it and the Privy fake, which holds each
// wallet under the ceiling binference builds for it.
const built: { bundle?: SignerBundle } = {};
const buyIn = 10n ** 16n;
// The agent's gas reserve on the fork, which a rescue leaves in each wallet.
const reserveBase = 2n * 10n ** 15n;

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-launch-");
}, 60_000);

afterAll(async () => {
  await built.bundle?.remove();
}, 60_000);

function call<Args>(args: Args, signal: AbortSignal) {
  return { args, caller: rigOwner, signal };
}

function expectValue<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T {
  if (!result.ok) {
    throw new BinferenceError({ code: "fork.refused", message: result.error });
  }
  return result.value;
}

// Proposes as the CLI would and taps Confirm on the card; answers the intent as proposed.
async function proposeAndTap(
  rig: LaunchRig,
  request: IntentRequest,
  signal: AbortSignal,
): Promise<IntentView> {
  const { handlers } = rig.engine;
  const view = expectValue(await handlers["intent/propose"](call(request, signal)));
  if (view.card === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: `No card: ${view.state}.` });
  }
  const tap = { intent: view.intent, card: view.card.card, cardVersion: 1 };
  expectValue(await handlers["intent/confirm"](call(tap, signal)));
  return view;
}

// Waits until the intent reaches the state, polling the store, for at most a minute.
async function reach(rig: LaunchRig, intent: Id<"int">, state: string): Promise<string> {
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

// Runs `test` with a fresh rig and a token launched on the suite's fork, mining in the background.
async function onLaunchRig(
  signal: AbortSignal,
  test: (rig: LaunchRig, fork: Fork, launched: ForkLaunch) => Promise<void>,
): Promise<void> {
  await withFork(signal, async (fork) => {
    const launched = await launchOnGeniusfun(fork);
    const entry = built.bundle?.entry ?? "";
    const rig = await launchRigOf(fork, { entry, token: launched.token }, signal);
    const miner = new AbortController();
    const mining = startMining(fork, miner.signal);
    try {
      await test(rig, fork, launched);
    } finally {
      miner.abort();
      await mining;
      await rig.stop();
    }
  });
}

function buyOf(rig: LaunchRig, fork: Fork, launched: ForkLaunch): IntentRequest {
  return {
    kind: "buy",
    agent: rig.agent,
    reason: "Buy the launch",
    token: erc20AssetRef(fork.chain, launched.token),
    spend: { asset: fork.chain.nativeAsset, base: buyIn },
  };
}

// A live buy of the launch's token with no wallet named, which runs from the launch wallet; what
// the launch wallet holds of the token once it reconciled.
async function boughtFromLaunch(
  rig: LaunchRig,
  fork: Fork,
  launched: ForkLaunch,
): Promise<{ readonly view: IntentView; readonly held: bigint }> {
  const signal = AbortSignal.timeout(90_000);
  const view = await proposeAndTap(rig, buyOf(rig, fork, launched), signal);
  expect(view.wallet).toBe(rig.launch.wallet);
  await expect(reach(rig, view.intent, "reconciled")).resolves.toBe("reconciled");
  const { token } = await heldOn(fork, { address: rig.launch.address, token: launched.token });
  return { view, held: token };
}

// The owner freezes the install and asks for a rescue, then taps Confirm on its card; answers the
// rescue's intent.
async function frozenAndRescued(rig: LaunchRig, signal: AbortSignal): Promise<Id<"int">> {
  const { handlers } = rig.engine;
  expectValue(await handlers["safety/freeze"](call({}, signal)));
  const { intent } = expectValue(await handlers["safety/rescue"](call({}, signal)));
  const view = expectValue(await handlers["intent/get"](call({ intent }, signal)));
  const card = view.card?.card;
  if (view.state !== "awaiting_confirmation" || card === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: "The rescue opened no card." });
  }
  expectValue(await handlers["intent/confirm"](call({ intent, card, cardVersion: 1 }, signal)));
  return intent;
}

async function allowanceOf(fork: Fork, owner: Address, launched: ForkLaunch): Promise<bigint> {
  return fork.client.readContract({
    address: launched.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, launched.curve],
  });
}

describe("a launch wallet on the BSC fork", () => {
  it("buys a new launch's token on its curve and sells it all back, live, from the launch wallet", async ({
    signal,
    annotate,
  }) =>
    onLaunchRig(signal, async (rig, fork, launched) => {
      const { view, held } = await boughtFromLaunch(rig, fork, launched);
      expect(held).toBeGreaterThan(0n);
      const sale: IntentRequest = {
        kind: "sell",
        agent: rig.agent,
        reason: "Take the profit",
        token: erc20AssetRef(fork.chain, launched.token),
        amount: { base: held },
      };
      const sold = await proposeAndTap(rig, sale, signal);
      expect(sold.wallet).toBe(rig.launch.wallet);
      await expect(reach(rig, sold.intent, "reconciled")).resolves.toBe("reconciled");
      const launchAfter = await heldOn(fork, {
        address: rig.launch.address,
        token: launched.token,
      });
      const mainAfter = await heldOn(fork, { address: rig.main.address, token: launched.token });
      expect(launchAfter.token).toBe(0n);
      expect(await allowanceOf(fork, rig.launch.address, launched)).toBe(0n);
      expect(mainAfter).toStrictEqual({ coin: rigFunding, token: 0n });
      expect(rig.refusals).toStrictEqual([]);
      await annotate(
        `block ${String(fork.block)}, launched ${launched.token} on curve ${launched.curve}: the launch wallet ${rig.launch.address} bought ${String(held)} for ${String(buyIn)} wei (${view.intent}), sold it all (${sold.intent}) and holds ${String(launchAfter.coin)} wei`,
      );
    }));

  it("refuses at signing a buy on the curve that names the main wallet, and sends nothing", async ({
    signal,
  }) =>
    onLaunchRig(signal, async (rig, fork, launched) => {
      const named: IntentRequest = { ...buyOf(rig, fork, launched), wallet: rig.main.wallet };
      const view = await proposeAndTap(rig, named, signal);
      expect(view.wallet).toBe(rig.main.wallet);
      await expect(reach(rig, view.intent, "cancelled")).resolves.toBe("cancelled");
      const events = await rig.stores.intents.events(view.intent, { signal });
      expect(events.at(-1)).toMatchObject({
        fromState: "executing",
        cause: { trigger: "step_unsent", cancelCause: "step_unsent" },
      });
      expect(rig.refusals).toStrictEqual([
        { wallet: rig.main.wallet, intent: view.intent, refused: "rule_2" },
      ]);
      const account = evmAccountRef(fork.chain, rig.main.address);
      const stored = await rig.stores.transactions.list(
        { account, fromNonce: 0, limit: 10 },
        { signal },
      );
      expect(stored).toStrictEqual([]);
      await expect(fork.client.getTransactionCount({ address: rig.main.address })).resolves.toBe(0);
      await expect(
        heldOn(fork, { address: rig.main.address, token: launched.token }),
      ).resolves.toStrictEqual({ coin: rigFunding, token: 0n });
    }));

  it("rescues the launch wallet's token and its BNB above the reserve to the rescue address", async ({
    signal,
    annotate,
  }) =>
    onLaunchRig(signal, async (rig, fork, launched) => {
      const { held } = await boughtFromLaunch(rig, fork, launched);
      const intent = await frozenAndRescued(rig, signal);
      await expect(reach(rig, intent, "reconciled")).resolves.toBe("reconciled");
      const left = await heldOn(fork, { address: rig.launch.address, token: launched.token });
      const rescued = await heldOn(fork, { address: rig.rescue, token: launched.token });
      expect(left.token).toBe(0n);
      expect(left.coin).toBeGreaterThan(0n);
      expect(left.coin).toBeLessThan(reserveBase);
      expect(rescued.token).toBe(held);
      expect(rescued.coin).toBeGreaterThan(0n);
      expect(rig.refusals).toStrictEqual([]);
      await annotate(
        `block ${String(fork.block)}: the rescue moved ${String(held)} of ${launched.token} and ${String(rescued.coin)} wei to ${rig.rescue}; the launch wallet keeps ${String(left.coin)} wei`,
      );
    }));
});
