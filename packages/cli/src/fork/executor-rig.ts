import { setTimeout as wait } from "node:timers/promises";
import {
  type AssetRef,
  type ChainRegistry,
  type PriceSource,
  type RelaySender,
} from "@binference/chain";
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
  bpsSchema,
  type Clock,
  createIdSource,
  type Http,
  type Id,
  type IdSource,
  idSchema,
} from "@binference/core";
import {
  createMemoryLogger,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type EngineStores,
  type LimitsValues,
  type PositionStore,
  type WalletFactsSource,
} from "@binference/engine";
import { createExecutor, type RunningExecutor } from "@binference/engine/executor";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakePriceSource,
  createFakeRiskCheck,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
} from "@binference/engine/testing";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import { keccak256, toHex } from "viem";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkCustody, forkWallet, pancakeV2Venue } from "./fork-trading.js";

/** A key made from fixed words: the fork's own test wallet, which holds nothing on BSC. */
export const walletKey: `0x${string}` = keccak256(toHex("binference executor fork wallet"));
/** The rig's live agent. */
export const agent: Id<"agt"> = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000043");
/** The agent's one wallet, whose key `walletKey` is. */
export const wallet: Id<"wal"> = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000043");
/** The token the rig's swaps buy. */
export const usdt: `0x${string}` = bscToken("USDT");
/** The BNB a swap of the rig spends unless a test says otherwise. */
export const buyIn: bigint = 10n ** 16n;

/** The engine and executor of one fork test, on memory stores and the fork's BSC. */
export interface Rig {
  readonly engine: Engine;
  readonly stores: EngineStores;
  readonly positions: PositionStore;
  readonly custody: ReturnType<typeof forkCustody>;
  readonly sends: { readonly raw: string; readonly stored: readonly string[] }[];
  readonly native: AssetRef;
  readonly bought: AssetRef;
  /** What the engine and its executor logged. */
  readonly logger: MemoryLogger;
}

/** The limits of a fork test's agents: a swap of the rig fits, and 0.002 BNB stays for gas. */
export function forkLimits(fork: Fork): LimitsValues {
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

/** What the rig's engine and executor share. */
interface RigParts {
  readonly fork: Fork;
  readonly clock: Clock;
  readonly chains: ChainRegistry;
  readonly stores: EngineStores;
  readonly positions: PositionStore;
  readonly custody: ReturnType<typeof forkCustody>;
  readonly prices: PriceSource;
  readonly wallets: WalletFactsSource;
  readonly ids: IdSource;
  readonly sends: Rig["sends"];
  readonly relayHttp: Http;
  readonly logger: MemoryLogger;
}

async function partsOf(fork: Fork, relayHttp: Http): Promise<RigParts> {
  const clock = createSystemClock();
  const native = fork.chain.nativeAsset;
  const address = forkWallet(walletKey).address;
  await fork.call("anvil_setCode", [address, "0x"]);
  await fork.call("anvil_setBalance", [address, toHex(10n ** 18n)]);
  const account = evmAccountRef(fork.chain, address);
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
  return {
    fork,
    clock,
    chains: selfHostedChains(),
    stores: createMemoryEngineStores(),
    positions: createMemoryPositionStore(),
    custody: forkCustody(wallet, account, walletKey),
    prices,
    wallets,
    ids: createIdSource({ clock, random: createSeededRandom(43) }),
    sends: [],
    relayHttp,
    logger: createMemoryLogger({ subsystem: "engine" }),
  };
}

function executorOf(parts: RigParts): RunningExecutor {
  const { fork, stores, clock } = parts;
  const { rpc, chain } = fork;
  const finality = { kind: "finalized_tag" } as const;
  return createExecutor({
    ...parts,
    queue: createWalletQueue({
      transactions: stores.transactions,
      nonces: createEvmNonceSource({ rpc, chain }),
      clock,
    }),
    sending: new Map([
      [
        chain.ref,
        {
          preparer: createEvmTxPreparer({ rpc, chain, networkFeeCap: 10n ** 10n }),
          sender: notingSender(fork, parts, parts.relayHttp),
          receipts: createEvmReceiptReader({ rpc, chain, finality }),
        },
      ],
    ]),
    publish: () => undefined,
  });
}

function engineOf(parts: RigParts, executor: RunningExecutor): Engine {
  const { fork, chains, clock } = parts;
  const { rpc, chain } = fork;
  return createEngine({
    ...parts,
    ceilings: createFakeCeilingEditor({ clock }),
    host: createVenueHost({
      venues: [pancakeV2Venue(fork, chain.nativeAsset)],
      chains,
      clock,
      callTimeoutMs: 15_000,
    }),
    risk: createFakeRiskCheck({ chains, clock }),
    simulator: createSimulationCheck({
      simulator: createEvmTxSimulator({ rpc, chain }),
      chains,
      clock,
    }),
    chainSimulator: createEvmTxSimulator({ rpc, chain }),
    executor,
    isLocked: () => false,
    paperBalances: [],
    random: createSeededRandom(44),
    publish: () => undefined,
  });
}

async function rigOf(fork: Fork, relayHttp: Http): Promise<Rig> {
  const parts = await partsOf(fork, relayHttp);
  const engine = engineOf(parts, executorOf(parts));
  await parts.stores.agents.create(
    {
      id: agent,
      name: "fork",
      mode: "live",
      locale: "en",
      models: {},
      notifications: {},
      atMs: parts.clock.now(),
      limits: forkLimits(fork),
      approvalMode: "manual",
      sendLevel: 0,
      bySurface: "cli",
    },
    { signal: AbortSignal.timeout(5_000) },
  );
  const { stores, positions, custody, sends, logger } = parts;
  const native = fork.chain.nativeAsset;
  const bought = erc20AssetRef(fork.chain, usdt);
  return { engine, stores, positions, custody, sends, native, bought, logger };
}

/** Mines blocks in the background, as BSC would, until the signal stops it. */
export function startMining(fork: Fork, signal: AbortSignal): Promise<void> {
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

/** How a fork test's rig runs: the Http its relays send through, and whether blocks come alone. */
export interface ForkRigOptions {
  readonly relayHttp?: (http: Http) => Http;
  /** Blocks are mined in the background from the start; when false, only as the test mines. */
  readonly isMining?: boolean;
}

/**
 * Runs `test` with a fresh rig on the suite's fork, mining in the background unless the options
 * say otherwise, and undoes the test's changes to the fork afterwards.
 */
export async function onFork(
  signal: AbortSignal,
  options: ForkRigOptions,
  test: (rig: Rig, fork: Fork) => Promise<void>,
): Promise<void> {
  await withFork(signal, async (fork) => {
    const rig = await rigOf(fork, options.relayHttp?.(fork.http) ?? fork.http);
    const miner = new AbortController();
    const mining = options.isMining === false ? Promise.resolve() : startMining(fork, miner.signal);
    try {
      await test(rig, fork);
    } finally {
      miner.abort();
      await mining;
    }
  });
}
