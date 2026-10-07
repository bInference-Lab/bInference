import { setTimeout as wait } from "node:timers/promises";
import { type AssetRef, type RelaySender } from "@binference/chain";
import {
  createEvmNonceSource,
  createEvmReceiptReader,
  createEvmRelaySender,
  createEvmTxPreparer,
  createEvmTxSimulator,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  BinferenceError,
  bpsSchema,
  createIdSource,
  type Http,
  type Id,
  idSchema,
} from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { createEngine, createVenueHost, type Engine, type EngineStores } from "@binference/engine";
import { createExecutor } from "@binference/engine/executor";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakePriceSource,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
} from "@binference/engine/testing";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import { erc20Abi, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkCustody, forkWallet, pancakeV2Venue } from "./fork-trading.js";

// A key made from fixed words: the fork's own test wallet, which holds nothing on BSC.
const walletKey = keccak256(toHex("binference executor fork wallet"));
const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000043");
const wallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000043");
const usdt = bscToken("USDT");
const buyIn = 10n ** 16n;
const caller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000043",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm"],
} as const;

/** The engine and executor of one fork test, on memory stores and the fork's BSC. */
interface Rig {
  readonly engine: Engine;
  readonly stores: EngineStores;
  readonly custody: ReturnType<typeof forkCustody>;
  readonly sends: { readonly raw: string; readonly stored: readonly string[] }[];
  readonly native: AssetRef;
  readonly bought: AssetRef;
}

function limitsFor(fork: Fork) {
  return {
    perTradeUsdMicros: 1_000_000_000n,
    rollingDayUsdMicros: 5_000_000_000n,
    slippageRegistryBps: bpsSchema.parse(100),
    slippageOtherBps: bpsSchema.parse(300),
    priceImpactBps: bpsSchema.parse(500),
    taxBps: bpsSchema.parse(1_000),
    liquidityFloorUsdMicros: 0n,
    minHealthFactorBp: 15_000,
    gasReserve: [{ chain: fork.chain.ref, reserveBase: 2n * 10n ** 15n }],
    venues: ["pancakeswap"],
    allowTokens: [],
    denyTokens: [],
    modelBudgetUsdMicros: 5_000_000n,
    cardTradeExpiryS: 60,
    cardOtherExpiryS: 600,
    requoteAfterS: 10,
    requoteToleranceBps: bpsSchema.parse(50),
    orderExpiryDays: 30,
    copyPerBuyUsdMicros: 20_000_000n,
    copyPerLeaderDayUsdMicros: 100_000_000n,
  };
}

// Sends through anvil as two relays, noting what the store held as each send began.
function notingSender(fork: Fork, rig: Pick<Rig, "stores" | "sends">, http: Http): RelaySender {
  const clock = createSystemClock();
  const relays = [
    { name: "anvil-a", url: fork.rpcUrl },
    { name: "anvil-b", url: fork.rpcUrl },
  ];
  const sender = createEvmRelaySender({ chain: fork.chain, relays, http, clock, timeoutMs: 5_000 });
  const account = evmAccountRef(fork.chain, forkWallet(walletKey).address);
  return {
    relays: sender.relays,
    async send(signed, call) {
      const query = { account, fromNonce: 0, limit: 10 };
      const stored = await rig.stores.transactions.list(query, call);
      rig.sends.push({ raw: signed.raw, stored: stored.map(({ raw }) => raw) });
      return sender.send(signed, call);
    },
  };
}

async function rigOf(fork: Fork, relayHttp: Http): Promise<Rig> {
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const native = fork.chain.nativeAsset;
  const address = forkWallet(walletKey).address;
  await fork.call("anvil_setCode", [address, "0x"]);
  await fork.call("anvil_setBalance", [address, toHex(10n ** 18n)]);
  const account = evmAccountRef(fork.chain, address);
  const stores = createMemoryEngineStores();
  const custody = forkCustody(wallet, account, walletKey);
  const sends: Rig["sends"] = [];
  const prices = createFakePriceSource(
    new Map([
      [native, { numerator: 600n, denominator: 10n ** 12n }],
      [erc20AssetRef(fork.chain, usdt), { numerator: 1n, denominator: 10n ** 12n }],
    ]),
  );
  const wallets = createFakeWalletFacts(new Map([[agent, [wallet]]]), {
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    feePerGasNativeBase: 10n ** 9n,
    networkFeeCapNativeBase: 10n ** 9n,
    recentOutflows: [],
  });
  const { rpc, chain } = fork;
  const finality = { kind: "finalized_tag" } as const;
  const ids = createIdSource({ clock, random: createSeededRandom(43) });
  const executor = createExecutor({
    stores,
    queue: createWalletQueue({
      transactions: stores.transactions,
      nonces: createEvmNonceSource({ rpc, chain }),
      clock,
    }),
    custody,
    wallets,
    prices,
    chains,
    sending: new Map([
      [
        chain.ref,
        {
          preparer: createEvmTxPreparer({ rpc, chain, networkFeeCap: 10n ** 10n }),
          sender: notingSender(fork, { stores, sends }, relayHttp),
          receipts: createEvmReceiptReader({ rpc, chain, finality }),
        },
      ],
    ]),
    clock,
    ids,
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
  const engine = createEngine({
    stores,
    positions: createMemoryPositionStore(),
    custody,
    prices,
    wallets,
    host: createVenueHost({
      venues: [pancakeV2Venue(fork, native)],
      chains,
      clock,
      callTimeoutMs: 15_000,
    }),
    simulator: createSimulationCheck({
      simulator: createEvmTxSimulator({ rpc, chain }),
      chains,
      clock,
    }),
    executor,
    paperBalances: [],
    chains,
    clock,
    ids,
    random: createSeededRandom(44),
    publish: () => undefined,
  });
  await stores.agents.create(
    {
      id: agent,
      name: "fork",
      mode: "live",
      locale: "en",
      models: {},
      notifications: {},
      atMs: clock.now(),
      limits: limitsFor(fork),
      approvalMode: "manual",
      bySurface: "cli",
    },
    { signal: AbortSignal.timeout(5_000) },
  );
  return { engine, stores, custody, sends, native, bought: erc20AssetRef(fork.chain, usdt) };
}

async function proposeAndTap(rig: Rig, signal: AbortSignal): Promise<Id<"int">> {
  const handlers = rig.engine.handlers;
  const request = {
    kind: "swap",
    agent,
    wallet,
    reason: "Buy USDT on the fork",
    from: rig.native,
    to: rig.bought,
    amount: { base: buyIn },
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

// Mines blocks in the background, as BSC would, until the test stops it.
function startMining(fork: Fork, signal: AbortSignal): Promise<void> {
  const mine = async (): Promise<void> => {
    if (signal.aborted) {
      return;
    }
    await fork.call("anvil_mine", ["0x10"]);
    await wait(150, undefined, { signal }).catch(() => undefined);
    await mine();
  };
  return mine();
}

// Waits until the intent reaches the state, polling the store, for at most a minute.
async function reach(rig: Rig, intent: Id<"int">, state: string): Promise<string> {
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

async function balanceOf(fork: Fork): Promise<bigint> {
  return fork.client.readContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [forkWallet(walletKey).address],
  });
}

async function onFork(
  signal: AbortSignal,
  options: { readonly relayHttp?: (http: Http) => Http },
  test: (rig: Rig, fork: Fork) => Promise<void>,
): Promise<void> {
  await withFork(signal, async (fork) => {
    const rig = await rigOf(fork, options.relayHttp?.(fork.http) ?? fork.http);
    const miner = new AbortController();
    const mining = startMining(fork, miner.signal);
    try {
      await test(rig, fork);
    } finally {
      miner.abort();
      await mining;
    }
  });
}

// An Http whose first `failures` requests reach no host, as relays that are down would.
function flaky(http: Http, failures: number): Http {
  let left = failures;
  return {
    async request(request) {
      if (left > 0) {
        left -= 1;
        throw new BinferenceError({ code: "http.unreachable", message: "Down.", retryable: true });
      }
      return http.request(request);
    },
  };
}

// The wallet's one transaction and each relay's answers to its sends; a test without one fails.
async function sentOnce(rig: Rig, fork: Fork, signal: AbortSignal) {
  const account = evmAccountRef(fork.chain, forkWallet(walletKey).address);
  const query = { account, fromNonce: 0, limit: 10 };
  const [transaction, ...others] = await rig.stores.transactions.list(query, { signal });
  if (transaction === undefined || others.length > 0) {
    throw new BinferenceError({ code: "fork.not_one", message: "Expected one transaction." });
  }
  const answers = await rig.stores.transactions.sends(transaction.id, { signal });
  return { transaction, answers };
}

describe("the executor on the BSC fork", () => {
  it("ends a confirmed swap finalized, its raw bytes stored before the first send", async ({
    signal,
  }) => {
    await onFork(signal, {}, async (rig, fork) => {
      const before = await balanceOf(fork);
      const intent = await proposeAndTap(rig, signal);
      await expect(reach(rig, intent, "finalized")).resolves.toBe("finalized");
      const { transaction, answers } = await sentOnce(rig, fork, signal);
      expect(transaction.state).toBe("final");
      const [first] = rig.sends;
      expect(first?.raw).toBe(transaction.raw);
      expect(first?.stored).toStrictEqual([transaction.raw]);
      expect(rig.custody.signatures()).toBe(1);
      const onChain = await fork.call("eth_getTransactionByHash", [transaction.hash]);
      expect(onChain).toMatchObject({ hash: transaction.hash });
      expect(await balanceOf(fork)).toBeGreaterThan(before);
      expect(answers.map(({ relay }) => relay)).toStrictEqual(["anvil-a", "anvil-b"]);
      expect(answers.map(({ outcome }) => outcome)).toContain("accepted");
    });
  });

  it("sends the same stored bytes again after a failed send, and never signs again", async ({
    signal,
  }) => {
    await onFork(signal, { relayHttp: (http) => flaky(http, 2) }, async (rig, fork) => {
      const intent = await proposeAndTap(rig, signal);
      await expect(reach(rig, intent, "finalized")).resolves.toBe("finalized");
      expect(rig.custody.signatures()).toBe(1);
      const { transaction, answers } = await sentOnce(rig, fork, signal);
      expect(rig.sends.map(({ raw }) => raw).slice(0, 2)).toStrictEqual([
        transaction.raw,
        transaction.raw,
      ]);
      expect(answers.slice(0, 2).map(({ outcome }) => outcome)).toStrictEqual([
        "unreachable",
        "unreachable",
      ]);
      expect(answers.slice(2).map(({ outcome }) => outcome)).toContain("accepted");
    });
  });
});
