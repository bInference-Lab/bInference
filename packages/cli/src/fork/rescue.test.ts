import { setTimeout as wait } from "node:timers/promises";
import { bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import type { Address } from "viem";
import { toHex } from "viem";
import { describe, expect, it } from "vitest";
import { startMining } from "./executor-rig.js";
import { buyFor, heldOn, type RescueRig, rescueAgents, rescueRigOf } from "./rescue-rig.js";

const owner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000061",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "loosen"],
  transport: "ipc",
} as const;
const reserveBase = 2n * 10n ** 15n;
const usdt = bscToken("USDT");
const cake = bscToken("Cake");

function call<Args>(args: Args, signal: AbortSignal) {
  return { args, caller: owner, signal };
}

function expectValue<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T {
  if (!result.ok) {
    throw new BinferenceError({ code: "fork.refused", message: result.error });
  }
  return result.value;
}

// Each wallet gets 0.05 BNB and 0.01 BNB worth of USDT, the first some Cake too; the fork's own
// account buys them one after another, as its nonce asks.
async function fund(fork: Fork, rig: RescueRig): Promise<void> {
  const purchases = [
    ...rig.wallets.map(({ address }) => ({ token: usdt, to: address, value: 10n ** 16n })),
    ...rig.wallets
      .slice(0, 1)
      .map(({ address }) => ({ token: cake, to: address, value: 10n ** 16n })),
  ];
  await Promise.all(
    [...rig.wallets.map(({ address }) => address), rig.rescue].map(async (address) =>
      fork.call("anvil_setCode", [address, "0x"]),
    ),
  );
  await Promise.all([
    ...rig.wallets.map(async ({ address }) =>
      fork.call("anvil_setBalance", [address, toHex(5n * 10n ** 16n)]),
    ),
    fork.call("anvil_setBalance", [rig.rescue, "0x0"]),
  ]);
  await purchases.reduce<Promise<void>>(
    async (earlier, purchase) => earlier.then(async () => buyFor(fork, purchase)),
    Promise.resolve(),
  );
}

async function holdings(fork: Fork, addresses: readonly Address[]) {
  return Promise.all(
    addresses.map(async (address) => ({
      ...(await heldOn(fork, { address, token: usdt })),
      cake: (await heldOn(fork, { address, token: cake })).token,
    })),
  );
}

async function reach(rig: RescueRig, intent: Id<"int">, state: string): Promise<string> {
  const deadline = Date.now() + 30_000;
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

// The owner taps Confirm on the rescue's card, as the CLI would; answers the intent then.
async function tapConfirm(rig: RescueRig, intent: Id<"int">, signal: AbortSignal) {
  const { handlers } = rig.engine;
  const view = expectValue(await handlers["intent/get"](call({ intent }, signal)));
  const card = view.card?.card;
  if (view.state !== "awaiting_confirmation" || card === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: "The rescue opened no card." });
  }
  const tap = { intent, card, cardVersion: 1 };
  return expectValue(await handlers["intent/confirm"](call(tap, signal)));
}

async function frozenAtStrictest(rig: RescueRig, signal: AbortSignal): Promise<void> {
  const { handlers } = rig.engine;
  expectValue(await handlers["safety/freeze"](call({}, signal)));
  const levels = await Promise.all(
    rescueAgents.map(async (agent) => handlers["sendLevel/set"](call({ agent, level: 3 }, signal))),
  );
  levels.forEach(expectValue);
}

describe("a rescue on the BSC fork", () => {
  it("moves every token and the BNB above the reserve of three frozen wallets to the rescue address", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const rig = await rescueRigOf(fork);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        await fund(fork, rig);
        const addresses = rig.wallets.map(({ address }) => address);
        const before = await holdings(fork, [...addresses, rig.rescue]);
        await frozenAtStrictest(rig, signal);
        const { handlers } = rig.engine;
        const { intent } = expectValue(await handlers["safety/rescue"](call({}, signal)));
        const again = expectValue(await handlers["safety/rescue"](call({}, signal)));
        expect(again.intent).toBe(intent);
        await expect(tapConfirm(rig, intent, signal)).resolves.toMatchObject({
          kind: "rescue",
          state: "confirmed",
          paper: false,
        });
        await expect(reach(rig, intent, "reconciled")).resolves.toBe("reconciled");
        const after = await holdings(fork, [...addresses, rig.rescue]);
        const walletsBefore = before.slice(0, 3);
        const walletsAfter = after.slice(0, 3);
        const moved = walletsBefore.reduce(
          (sum, held) => ({
            coin: sum.coin + held.coin - reserveBase,
            token: sum.token + held.token,
            cake: sum.cake + held.cake,
          }),
          { coin: 0n, token: 0n, cake: 0n },
        );
        for (const held of walletsAfter) {
          expect(held.token).toBe(0n);
          expect(held.cake).toBe(0n);
          expect(held.coin).toBeGreaterThan(0n);
          expect(held.coin).toBeLessThan(reserveBase);
        }
        expect(after.at(-1)).toStrictEqual({
          coin: moved.coin,
          token: moved.token,
          cake: moved.cake,
        });
        expect(rig.signatures()).toBe(7);
        await expect(handlers["safety/rescue"](call({}, signal))).resolves.toStrictEqual({
          ok: false,
          error: "rescue.nothing_to_move",
        });
      } finally {
        miner.abort();
        await mining;
      }
    });
  });
});
