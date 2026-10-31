import { setTimeout as wait } from "node:timers/promises";
import { type AccountRef, accountRefSchema } from "@binference/chain";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { createSpaceIdResolver } from "@binference/spaceid";
import {
  type PlacementParts,
  type PlacementStep,
  pointStep,
  readPlacementParts,
  registerSteps,
} from "@binference/spaceid/testing";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  stringToHex,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { startMining } from "./executor-rig.js";
import { buyFor, heldOn, type RescueRig, rescueAgents, rescueRigOf } from "./rescue-rig.js";

// Sends and approval revokes on a fork of BSC: a `.bnb` name placed as SPACE ID's controllers and
// its holder place one, saved in the agent's address book, then paid by name; and a router's
// allowance set back to zero.
const owner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000066",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "loosen"],
  transport: "ipc",
} as const;
const contracts = {
  registry: bscContract("spaceid", "registry"),
  registrar: bscContract("spaceid", "base-registrar"),
};
const usdt = bscToken("USDT");
const router = bscContract("pancakeswap", "v2-router");
const label = "binference-send-alice";
const name = `${label}.bnb`;
const holder = accountOf("binference send holder");
const later = accountOf("binference send later");
const [
  agent = rescueAgents[0] ?? idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000061"),
] = rescueAgents;

function accountOf(phrase: string): Address {
  return getAddress(keccak256(stringToHex(phrase)).slice(0, 42));
}

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

async function sendAs(fork: Fork, steps: readonly PlacementStep[]): Promise<void> {
  for (const step of steps) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await fork.call("anvil_impersonateAccount", [step.from]);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await fork.call("anvil_setBalance", [step.from, toHex(10n ** 18n)]);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    expect((await fork.send(step)).status).toBe("success");
  }
}

async function placeName(fork: Fork, signal: AbortSignal): Promise<PlacementParts> {
  const parts = await readPlacementParts(contracts, { rpc: fork.rpc, signal });
  await sendAs(fork, registerSteps(parts, { label, holder, address: holder }));
  return parts;
}

function resolverOn(fork: Fork) {
  const refOf = (address: Address): AccountRef =>
    accountRefSchema.parse(`${fork.chain.ref}:${address}`);
  return createSpaceIdResolver({
    chain: fork.chain.ref,
    rpc: fork.rpc,
    contracts: {
      registry: refOf(contracts.registry),
      "base-registrar": refOf(contracts.registrar),
    },
  });
}

// The agent's main wallet holds 0.05 BNB and what 0.05 BNB buys of USDT; the holder holds no code.
async function fund(fork: Fork, rig: RescueRig): Promise<Address> {
  const [main] = rig.wallets;
  if (main === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "The rig has no wallet." });
  }
  await Promise.all(
    [main.address, holder].map(async (address) => fork.call("anvil_setCode", [address, "0x"])),
  );
  await fork.call("anvil_setBalance", [main.address, toHex(5n * 10n ** 16n)]);
  await buyFor(fork, { token: usdt, to: main.address, value: 5n * 10n ** 16n });
  return main.address;
}

// The holder's address saved with the owner key three days ago, as `address add` saves one.
async function saveHolder(fork: Fork, rig: RescueRig): Promise<void> {
  const atMs = Date.now() - 3 * 86_400_000;
  const entry = {
    id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000066"),
    agentId: agent,
    account: evmAccountRef(fork.chain, holder),
    label: "alice",
    usableAtMs: atMs,
    inCeilingAtMs: atMs,
    createdAtMs: atMs,
  };
  expectValue(await rig.stores.agents.addAddress(entry, { signal: AbortSignal.timeout(5_000) }));
}

async function propose(
  rig: RescueRig,
  request: IntentRequest,
  signal: AbortSignal,
): Promise<IntentView> {
  return expectValue(await rig.engine.handlers["intent/propose"](call(request, signal)));
}

async function cardText(
  rig: RescueRig,
  view: IntentView,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const drawn = expectValue(
    await rig.engine.handlers["intent/card"](call({ intent: view.intent }, signal)),
  );
  const display = {
    formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
    assets: drawn.assets,
  };
  return drawn.lines.map((line) => cardLineText(line, display));
}

async function confirm(rig: RescueRig, view: IntentView, signal: AbortSignal): Promise<void> {
  const card = view.card?.card;
  if (card === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: `${view.kind} opened no card.` });
  }
  expectValue(
    await rig.engine.handlers["intent/confirm"](
      call({ intent: view.intent, card, cardVersion: 1 }, signal),
    ),
  );
}

async function reach(
  rig: RescueRig,
  intent: Id<"int">,
  states: readonly string[],
): Promise<string> {
  const deadline = Date.now() + 30_000;
  const poll = async (): Promise<string> => {
    const record = await rig.stores.intents.get(intent, { signal: AbortSignal.timeout(5_000) });
    if ((record !== undefined && states.includes(record.state)) || Date.now() > deadline) {
      return record?.state ?? "missing";
    }
    await wait(200);
    return poll();
  };
  return poll();
}

function sendByName(base: bigint, fork: Fork): IntentRequest {
  const amount = { asset: erc20AssetRef(fork.chain, usdt), base };
  return { kind: "send", agent, reason: "Pay Alice", amount, to: { name } };
}

const ended = ["reconciled", "failed_check", "failed_onchain", "expired", "cancelled"];

describe("sends and approval revokes on the BSC fork", () => {
  it("pays 20 USDT to a SPACE ID name with the name and the address on its card, and refuses one whose name moved", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const parts = await placeName(fork, signal);
      const rig = await rescueRigOf(fork, [resolverOn(fork)]);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        await fund(fork, rig);
        await saveHolder(fork, rig);
        const twenty = 20n * 10n ** 18n;
        const view = await propose(rig, sendByName(twenty, fork), signal);
        expect(view).toMatchObject({
          state: "awaiting_confirmation",
          resolvedName: { name, address: evmAccountRef(fork.chain, holder) },
        });
        const lines = await cardText(rig, view, signal);
        expect(lines[1]).toBe(`Send 20 USDT to ${name} (${holder})`);
        expect(lines[2]).toMatch(new RegExp(`^${name} points to ${holder}, read at `));
        await confirm(rig, view, signal);
        await expect(reach(rig, view.intent, ended)).resolves.toBe("reconciled");
        await expect(heldOn(fork, { address: holder, token: usdt })).resolves.toMatchObject({
          token: twenty,
        });

        const moving = await propose(rig, sendByName(10n ** 18n, fork), signal);
        expect(moving.state).toBe("awaiting_confirmation");
        await sendAs(fork, [pointStep(parts, { name, holder, address: later })]);
        const signed = rig.signatures();
        await confirm(rig, moving, signal);
        await expect(reach(rig, moving.intent, ended)).resolves.toBe("failed_check");
        const record = await rig.stores.intents.get(moving.intent, { signal });
        expect([record?.reason, rig.signatures()]).toStrictEqual(["name_moved", signed]);
      } finally {
        miner.abort();
        await mining;
      }
    });
  });

  it("sets a router's USDT allowance back to zero", async ({ signal }) => {
    await withFork(signal, async (fork) => {
      const rig = await rescueRigOf(fork);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        const wallet = await fund(fork, rig);
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [router, 5n * 10n ** 18n],
        });
        await sendAs(fork, [{ from: wallet, to: usdt, data }]);
        const allowance = async () =>
          fork.client.readContract({
            address: usdt,
            abi: erc20Abi,
            functionName: "allowance",
            args: [wallet, router],
          });
        await expect(allowance()).resolves.toBe(5n * 10n ** 18n);
        const request: IntentRequest = {
          kind: "revokeApproval",
          agent,
          reason: "Clear the router's approval",
          token: erc20AssetRef(fork.chain, usdt),
          spender: evmAccountRef(fork.chain, router),
        };
        const view = await propose(rig, request, signal);
        expect(view.state).toBe("awaiting_confirmation");
        await confirm(rig, view, signal);
        await expect(reach(rig, view.intent, ended)).resolves.toBe("reconciled");
        await expect(allowance()).resolves.toBe(0n);
      } finally {
        miner.abort();
        await mining;
      }
    });
  });
});
