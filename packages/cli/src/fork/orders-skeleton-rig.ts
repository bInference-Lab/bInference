import { evmAccountRef, erc20AssetRef, createEvmTxSimulator } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError, type Clock, idSchema, type Id } from "@binference/core";
import {
  createMemoryLogger,
  createMemoryWorkspaceFiles,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import { createSourceMarketReads } from "@binference/engine/market";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakeExecutor,
  createFakePriceSource,
  createFakeWalletFacts,
  createFakeWalletMaker,
  createMemoryEngineStores,
  createMemoryPositionStore,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
  testWalletRecord,
} from "@binference/engine/testing";
import { keccak256, toHex } from "viem";
import { type ComposedEngine, composeEngine, type EngineParts } from "../compose/compose-engine.js";
import type { ComposedTelegram, TelegramParts } from "../compose/compose-telegram.js";
import { type LoopbackServing, serveOnLoopback } from "../compose/loopback-serving.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import {
  addSkeletonTokens,
  readyEngineOperations,
  skeletonSecrets,
} from "../compose/test-skeleton.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkLimits } from "./executor-rig.js";
import { createFeeTokenVenue } from "./fee-token-venue.js";
import { forkCustody, forkTokenFacts, forkWallet } from "./fork-trading.js";
import { xvs } from "./order-fill-rig.js";

/** A key made from fixed words: the skeleton's wallet, which holds nothing on BSC. */
const walletKey: `0x${string}` = keccak256(toHex("binference orders skeleton fork wallet"));
/** The skeleton's paper agent and its one wallet. */
export const skeletonAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-000000000038",
);
const skeletonWallet: Id<"wal"> = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000038");
// The agent's daily model budget: $3, the default.
const modelBudgetUsdMicros = 3_000_000n;

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

// What the wallet facts say of the wallet: 1 BNB, and a fee per gas under the cap.
const walletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 10n ** 9n,
  networkFeeCapNativeBase: 10n ** 9n,
  recentOutflows: [],
};

/** The engine on the fork with its server, the owner's bot and what a test reads of it. */
export interface OrdersMachine extends LoopbackServing {
  readonly composed: ComposedEngine;
  /** The owner's bot joined to the engine. */
  readonly bot: ComposedTelegram;
  readonly stores: MemoryEngineStores;
  readonly server: ComposedEngine["server"];
  readonly turns: RunningTurns;
  readonly clock: Clock;
  readonly logger: MemoryLogger;
}

// The profile parts on the fork: custody of the one wallet, BNB at $600, XVS, a token the registry
// does not list, clean at the one required risk source, and no market data.
function partsOn(fork: Fork, stores: MemoryEngineStores): EngineParts {
  const clock = createSystemClock();
  const account = evmAccountRef(fork.chain, forkWallet(walletKey).address);
  const token = erc20AssetRef(fork.chain, xvs);
  const clean = { flags: [], liquidityUsdMicros: 10n ** 15n };
  const native = fork.chain.nativeAsset;
  return {
    custody: forkCustody(skeletonWallet, account, walletKey),
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: fork.chain.ref, family: "evm" }),
    stores,
    prices: createFakePriceSource(
      new Map([[native, { numerator: 600n, denominator: 10n ** 12n }]]),
    ),
    riskSources: [
      {
        source: createFakeRiskSource({ id: "goplus", reports: new Map([[token, clean]]) }),
        isRequired: true,
      },
    ],
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
  };
}

// The paper agent in manual mode, its wallet and the CLI token.
async function seed(parts: EngineParts & { readonly stores: MemoryEngineStores }, fork: Fork) {
  const atMs = createSystemClock().now();
  await parts.stores.agents.create(
    {
      id: skeletonAgent,
      name: "main",
      mode: "paper",
      locale: "en",
      models: {},
      notifications: {},
      atMs,
      limits: { ...forkLimits(fork), modelBudgetUsdMicros },
      approvalMode: "manual",
      sendLevel: 0,
      bySurface: "cli",
    },
    live(),
  );
  const wallet = { id: skeletonWallet, agentId: skeletonAgent, label: "main", createdAtMs: atMs };
  parts.stores.install.addWallet(testWalletRecord(wallet));
  await addSkeletonTokens(parts);
}

/**
 * Composes and serves the engine on the suite's fork as `binference start` does, on paper with the
 * owner's bot: the fork's PancakeSwap v2 pairs, simulations on the fork, the agent's limits with a
 * $3 model budget, and the owner's language and timezone, English in UTC.
 */
export async function startOrdersMachine(
  fork: Fork,
  telegram: TelegramParts,
): Promise<OrdersMachine> {
  const stores = createMemoryEngineStores();
  const parts = { ...partsOn(fork, stores), stores };
  await seed(parts, fork);
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const { rpc, chain } = fork;
  const simulator = createEvmTxSimulator({ rpc, chain });
  const turns = createRunningTurns();
  const venue = createFeeTokenVenue({ fork, nativeAsset: chain.nativeAsset, via: new Map() });
  const logger = createMemoryLogger({ subsystem: "engine" });
  const composed = composeEngine(parts, {
    chains,
    venues: [venue],
    simulator: createSimulationCheck({ simulator, chains, clock }),
    risk: { cache: createMemoryRiskCacheStore(["goplus"]), cacheTtlMs: 600_000, simulator },
    wallets: createFakeWalletFacts(new Map([[skeletonAgent, [skeletonWallet]]]), walletFacts),
    executor: createFakeExecutor(),
    positions: createMemoryPositionStore(),
    paperBalances: [{ asset: chain.nativeAsset, base: 10n ** 18n }],
    version: "2026.10.0",
    owner: () => ({ locale: "en", timezone: "UTC" }),
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: forkTokenFacts(fork),
    workspace: createMemoryWorkspaceFiles(clock),
    handlers: readyEngineOperations(parts.stores.agents),
    turns,
    telegram,
    clock,
    random: createSeededRandom(38),
    logger,
  });
  const served = await serveOnLoopback(composed, { clock, cliSecret: skeletonSecrets.cli });
  const bot = composed.telegram;
  if (bot === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The engine serves the bot." });
  }
  return { ...served, composed, bot, stores, server: composed.server, turns, clock, logger };
}
