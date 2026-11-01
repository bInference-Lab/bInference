import { setTimeout as wait } from "node:timers/promises";
import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { baseMainnet } from "@binference/chains";
import { BinferenceError, type Http, type Id, idSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { pointStep } from "@binference/spaceid/testing";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  parseEventLogs,
  stringToHex,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "../compose/chain-reads.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { selfHostedBridging } from "../compose/self-hosted-bridging.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { forkLimits, startMining } from "./executor-rig.js";
import { buyFor, heldOn } from "./fork-holdings.js";
import { rescueAgents } from "./rescue-rig-parts.js";
import { type RescueRig, rescueRigOf } from "./rescue-rig.js";
import { placeName, sendAs, spaceIdOn } from "./space-id-names.js";

// Sends, approval revokes and bridges on a fork of BSC: a `.bnb` name placed as SPACE ID's
// controllers and its holder place one, saved in the agent's address book, then paid by name; a
// router's allowance set back to zero; and USDC bridged through Across to an address saved for Base.
const owner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000066",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "loosen"],
  transport: "ipc",
} as const;
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
    recipientBytes: holder.toLowerCase(),
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
      const parts = await placeName(fork, { label, holder, address: holder }, signal);
      const rig = await rescueRigOf(fork, [spaceIdOn(fork)]);
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

const usdc = bscToken("USDC");
const spokePool = bscContract("across", "spoke-pool");
const acrossOrigin = "https://app.across.to";
const baseRef = chainRefSchema.parse(baseMainnet.id);
// The USDC that arrives on Base, as the registry lists it.
const baseUsdc = accountRefSchema.parse(
  `${baseMainnet.id}:${baseMainnet.tokens.find((token) => token.symbol === "USDC")?.address ?? ""}`,
);
const baseHolder = evmAccountRefOn(baseRef, holder);
const network = createSystemHttp({ version: "test" });
const depositEvents = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);

function evmAccountRefOn(chain: string, address: Address): AccountRef {
  return accountRefSchema.parse(`${chain}:${address}`);
}

// What a bridge reaches: the fork for BSC, Across's public API for its quote and deposit, and
// Base's public nodes for the account code of the saved address there. Nothing else.
function bridgeHttp(fork: Fork): Http {
  const reads = new Set([acrossOrigin, ...baseMainnet.rpcs.map(({ url }) => new URL(url).origin)]);
  return {
    async request(request) {
      if (request.url.startsWith(fork.rpcUrl)) {
        return fork.http.request(request);
      }
      if (reads.has(new URL(request.url).origin)) {
        return network.request(request);
      }
      throw new BinferenceError({
        code: "fork.call_refused",
        message: `The fork test reaches no ${new URL(request.url).host}.`,
      });
    },
  };
}

// The bridging parts `binference start` composes, over the fork's BSC.
function bridgingOn(fork: Fork) {
  const http = bridgeHttp(fork);
  const clock = createSystemClock();
  const config = {
    enabled: [fork.chain.ref],
    rpc: { [fork.chain.ref]: { urls: [fork.rpcUrl] } },
    relays: {},
    maxFeePerGasGwei: { [fork.chain.ref]: "10" },
  };
  const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
  return selfHostedBridging({ http, clock, reads });
}

// The agent may bridge through Across, and the main wallet's ceiling pays the holder on Base
// through its bridge rule, with a 24-hour cap on USDC, as custody reads it back.
async function readyToBridge(fork: Fork, rig: RescueRig, signal: AbortSignal): Promise<Id<"adr">> {
  const settings = await rig.stores.agents.get(agent, { signal });
  const limits = { ...forkLimits(fork), venues: ["pancakeswap", "across"] };
  const atMs = Date.now();
  const expectedVersion = settings?.limits.version ?? 0;
  expectValue(
    await rig.stores.agents.setLimits(
      { agentId: agent, limits, atMs, expectedVersion },
      { signal },
    ),
  );
  const cap = { asset: erc20AssetRef(fork.chain, usdc), limit: String(10n ** 24n) };
  const policy = {
    chains: [fork.chain.ref],
    contracts: [evmAccountRef(fork.chain, spokePool)],
    perTxNativeBase: String(10n ** 18n),
    recipients: [evmAccountRef(fork.chain, rig.rescue)],
    bridged: [baseHolder],
    dayCaps: [{ ...cap, windowSeconds: 86_400, floorUsdMicros: "0" }],
    launchCalls: [],
    functions: [],
  };
  const ceiling = { policyId: "privy-policy-bridge", policy, perTxNativeBase: 10n ** 18n };
  const update = { wallet: mainOf(rig).wallet, ceiling: { ...ceiling, readAtMs: atMs } };
  expectValue(await rig.stores.install.updateCeiling(update, { signal }));
  // The holder's address saved for Base with the owner key three days ago.
  const savedAtMs = atMs - 3 * 86_400_000;
  const entry = {
    id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000067"),
    agentId: agent,
    account: baseHolder,
    recipientBytes: holder.toLowerCase(),
    label: "alice on base",
    usableAtMs: savedAtMs,
    inCeilingAtMs: savedAtMs,
    createdAtMs: savedAtMs,
  };
  expectValue(await rig.stores.agents.addAddress(entry, { signal }));
  return entry.id;
}

// The FundsDeposited event Across's SpokePool logged in the deposit's receipt.
async function depositLogOf(fork: Fork, rig: RescueRig, intent: Id<"int">) {
  const stored = await rig.stores.transactions.ofIntent(intent, {
    signal: AbortSignal.timeout(5_000),
  });
  const deposit = stored.findLast(({ receipt }) => receipt !== undefined);
  const receipt = await fork.client.getTransactionReceipt({ hash: (deposit?.hash ?? "0x") as Hex });
  const log = parseEventLogs({ abi: depositEvents, logs: receipt.logs }).find(
    (item) => getAddress(item.address) === spokePool,
  );
  if (log === undefined) {
    throw new BinferenceError({
      code: "fork.no_deposit",
      message: "The SpokePool logged no deposit.",
    });
  }
  return log.args;
}

function mainOf(rig: RescueRig) {
  const [main] = rig.wallets;
  if (main === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "The rig has no wallet." });
  }
  return main;
}

const word = (address: Address): string => pad(address).toLowerCase();

describe("a bridge on the BSC fork", () => {
  it("deposits 20 USDC through Across for an address saved for Base, held to its card, and opens it in transit", async ({
    signal,
    annotate,
  }) => {
    await withFork(signal, async (fork) => {
      const rig = await rescueRigOf(fork, [], bridgingOn(fork));
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        const wallet = await fund(fork, rig);
        await buyFor(fork, { token: usdc, to: wallet, value: 5n * 10n ** 16n });
        const entry = await readyToBridge(fork, rig, signal);
        const twenty = 20n * 10n ** 18n;
        const request: IntentRequest = {
          kind: "bridge",
          agent,
          reason: "Move USDC to Base",
          amount: { asset: erc20AssetRef(fork.chain, usdc), base: twenty },
          toChain: baseRef,
          to: { entry },
        };
        const view = await propose(rig, request, signal);
        expect([view.state, view.outcome]).toStrictEqual(["awaiting_confirmation", undefined]);
        const lines = await cardText(rig, view, signal);
        await annotate(lines.join("\n"));
        expect(lines[1]).toMatch(
          new RegExp(
            `^Bridge 20 USDC to Base · to alice on base \\(${holder}\\) · about \\d+ min$`,
          ),
        );
        expect(lines).toContainEqual(
          expect.stringMatching(/receives at least 19\.\d+ USDC on Base$/),
        );
        expect(lines).toContainEqual(expect.stringMatching(/^Bridge fees .+ · through across$/));

        await confirm(rig, view, signal);
        await expect(reach(rig, view.intent, ["finalized", ...ended])).resolves.toBe("finalized");
        const bridge = await rig.stores.bridges.get(view.intent, { signal });
        expect(bridge).toMatchObject({
          state: "in_transit",
          recipient: baseHolder,
          toChain: baseRef,
        });
        const logged = await depositLogOf(fork, rig, view.intent);
        expect([
          logged.recipient,
          logged.depositor,
          logged.destinationChainId,
          logged.inputAmount,
          logged.outputAmount,
        ]).toStrictEqual([word(holder), word(wallet), 8453n, twenty, bridge?.minOut.base]);
        const deposit = rig.asked.at(-1)?.allowed.callInputs?.[0];
        expect(deposit).toMatchObject({
          equal: {
            recipient: holder.toLowerCase(),
            destinationChainId: "8453",
            inputToken: usdc.toLowerCase(),
            outputToken: accountRefParts(baseUsdc).address.toLowerCase(),
            inputAmount: String(twenty),
          },
          atLeast: { outputAmount: String(bridge?.minOut.base) },
        });
      } finally {
        miner.abort();
        await mining;
      }
    });
  }, 120_000);
});
