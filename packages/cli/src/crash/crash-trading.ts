import { setTimeout as wait } from "node:timers/promises";
import type {
  AccountRef,
  AssetRef,
  ChainRegistry,
  PriceSource,
  Signer,
  Venue,
} from "@binference/chain";
import { erc20AssetRef, type EvmChain, evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import { bpsSchema, createIdSource, ok } from "@binference/core";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type PositionStore,
  type WalletFacts,
  type WalletFactsSource,
} from "@binference/engine";
import type { RunningExecutor } from "@binference/engine/executor";
import {
  createFakeCeilingEditor,
  createFakeWalletMaker,
  createFakePriceSource,
  createFakeRiskCheck,
  createFakeWalletFacts,
  createMemoryPositionStore,
  createQuoteSimulator,
} from "@binference/engine/testing";
import { composeChainReads } from "../compose/chain-reads.js";
import { composeExecutor } from "../compose/compose-executor.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { agent, usdt, wallet } from "../fork/executor-rig.js";
import { forkCustody, forkWallet, pancakeV2Trades } from "../fork/fork-trading.js";
import type { CrashEvent } from "./crash-engine.schema.js";
import { crashWalletKey } from "./crash-wallet.js";
import type { CrashOpened } from "./open-crash-engine.js";

/** The crash engine's money path: the engine that proposes and confirms, and its executor. */
export interface CrashTrading {
  readonly engine: Engine;
  /** The executor as `binference start` composes it, over the test's chain and relays. */
  readonly executor: RunningExecutor;
  /** The run's wallet on BSC. */
  readonly account: AccountRef;
  readonly native: AssetRef;
  /** What its swaps buy: USDT. */
  readonly bought: AssetRef;
}

/** How the crash engine's custody signs: the run's wallet, and whether it holds after signing. */
export interface CrashSigning {
  /** The run's name, which makes the wallet's key. */
  readonly walletName: string;
  /** Holds after the first signature, before the engine stores the bytes, until it is killed. */
  readonly isHolding: boolean;
  readonly report: (event: CrashEvent) => void;
}

// Long past any run's timeout: a holding engine waits to be killed, never to go on.
const holdMs = 600_000;
// BNB at $600 and USDT at $1, each per base unit of 18 decimals.
const bnbPrice = { numerator: 600n, denominator: 10n ** 12n };
const usdtPrice = { numerator: 1n, denominator: 10n ** 12n };
const facts: WalletFacts = {
  recentOutflows: [],
  feePerGasNativeBase: 10n ** 9n,
  networkFeeCapNativeBase: 10n ** 10n,
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
};

// Custody that reports each signature, and holds after one when the run kills the engine there.
function reportingCustody(custody: Signer, signing: CrashSigning): Signer {
  return {
    account: async (asked, chain, call) => custody.account(asked, chain, call),
    async signTransaction(request, call) {
      const signed = await custody.signTransaction(request, call);
      if (signed.ok) {
        signing.report({ event: "signed" });
      }
      if (signed.ok && signing.isHolding) {
        signing.report({ event: "holding" });
        await wait(holdMs, undefined, { signal: call.signal });
      }
      return signed;
    },
  };
}

// PancakeSwap's v2 router, quoted at the fixed prices. On the test's chain the router holds no
// code, so a buy pays the router its BNB and nothing comes back, and reconciliation records it so.
function crashVenue(chain: EvmChain): Venue {
  return {
    ...pancakeV2Trades(chain, chain.nativeAsset),
    async quote(request) {
      const expectedOut = { asset: request.assetOut, base: request.amountIn.base * 600n };
      return Promise.resolve(ok({ expectedOut, priceImpactBps: bpsSchema.parse(5) }));
    },
  };
}

interface TradingParts {
  readonly chains: ChainRegistry;
  readonly custody: Signer;
  readonly positions: PositionStore;
  readonly prices: PriceSource;
  readonly wallets: WalletFactsSource;
  readonly executor: RunningExecutor;
}

function engineOf(opened: CrashOpened, chain: EvmChain, parts: TradingParts): Engine {
  const { clock, random } = opened.host;
  const { chains } = parts;
  return createEngine({
    ...parts,
    stores: opened.stores,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: chain.ref, family: "evm" }),
    host: createVenueHost({ venues: [crashVenue(chain)], chains, clock, callTimeoutMs: 15_000 }),
    risk: createFakeRiskCheck({ chains, clock }),
    simulator: createQuoteSimulator(() => undefined),
    chainSimulator: createFakeTxSimulator(new Map()),
    paperBalances: [],
    isLocked: () => false,
    clock,
    ids: createIdSource({ clock, random }),
    random,
    publish: () => undefined,
  });
}

/**
 * Composes the crash engine's money path on its opened stores: custody signs with the run's
 * wallet key and reports each signature; prices, wallet facts, risk and the simulation are fakes
 * and positions live in memory, since the self-hosted root has no adapters for them yet; the
 * executor is the one `binference start` composes, over the chains config names, which point at
 * the test's chain and relays.
 */
export function composeCrashTrading(opened: CrashOpened, signing: CrashSigning): CrashTrading {
  const { host, stores, config, logger } = opened;
  const chain = evmChainOf(bsc);
  const key = crashWalletKey(signing.walletName);
  const account = evmAccountRef(chain, forkWallet(key).address);
  const bought = erc20AssetRef(chain, usdt);
  const prices = new Map([
    [chain.nativeAsset, bnbPrice],
    [bought, usdtPrice],
  ]);
  const parts = {
    chains: selfHostedChains(),
    custody: reportingCustody(forkCustody(wallet, account, key), signing),
    positions: createMemoryPositionStore(),
    prices: createFakePriceSource(prices),
    wallets: createFakeWalletFacts(new Map([[agent, [wallet]]]), facts),
  };
  const reads = composeChainReads({
    chains: parts.chains,
    config: config.chains,
    http: host.http,
    clock: host.clock,
  });
  const { executor } = composeExecutor({
    ...parts,
    stores,
    reads,
    relays: config.chains.relays,
    http: host.http,
    clock: host.clock,
    random: host.random,
    publish: () => undefined,
    logger,
  });
  const engine = engineOf(opened, chain, { ...parts, executor });
  return { engine, executor, account, native: chain.nativeAsset, bought };
}
