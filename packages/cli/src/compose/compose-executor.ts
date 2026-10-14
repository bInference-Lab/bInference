import {
  type AccountRef,
  accountRefParts,
  type ChainRef,
  type ChainRegistry,
  type NonceSource,
  type PriceSource,
  type RegisteredChain,
  type Signer,
  type Venue,
} from "@binference/chain";
import {
  createEvmNonceSource,
  createEvmReceiptReader,
  createEvmRelaySender,
  createEvmTxPreparer,
  createRpcFailover,
  type RpcEndpoint,
} from "@binference/chain-evm";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Http,
  type Logger,
  type Random,
} from "@binference/core";
import {
  createVenueHost,
  type EnginePush,
  type EngineStores,
  type PositionStore,
  type WalletFactsSource,
} from "@binference/engine";
import {
  type ChainSending,
  createExecutor,
  type RunningExecutor,
} from "@binference/engine/executor";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import type { ChainReads } from "./chain-reads.js";
import type { HealthSignal } from "./health-signals.js";
import { createRelayHealth, type RelayHealth } from "./relay-health.js";

/** The executor of a self-hosted engine, and its health signal. */
export interface ComposedExecutor {
  readonly executor: RunningExecutor;
  /** The `executor` signal: how the private relays answered the last sends. */
  readonly health: () => HealthSignal["state"];
}

/** What the executor is built from: the engine's stores and parts, the chains and their config. */
export interface ComposeExecutorOptions {
  readonly stores: EngineStores;
  /** Where reconciliation records each live trade. */
  readonly positions: PositionStore;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
  /**
   * The venues: their declarations name the contracts the signer lets a trade's steps reach, and
   * the launchpads' curve reads name a launch wallet's launch contracts again (decision 0217).
   */
  readonly venues: readonly Venue[];
  /** Each enabled chain's RPC failover and network fee cap. */
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The relays config names for each chain; every relay the chain lists when it names none. */
  readonly relays: ChainsConfig["relays"];
  /** The owner's tracing RPC of each chain that has one (decision 0108). */
  readonly tracers?: ReadonlyMap<ChainRef, string>;
  /** Outbound HTTP for the chains' relays and tracing RPCs. */
  readonly http: Http;
  readonly clock: Clock;
  readonly random: Random;
  readonly publish: (push: EnginePush) => void;
  readonly logger: Logger;
  /** Whether live order fills may sign: only a test host turns them on (decision 0211). */
  readonly liveOrderFills?: boolean;
}

// A node rests 30 s after a failure; a relay gets 3 s, several BSC blocks, to take a transaction.
// A launchpad's curve read before a signature gets as long as any venue call.
const curveReadTimeoutMs = 5_000;
const rpcRestMs = 30_000;
const relayTimeoutMs = 3_000;
// A tracer replays a whole transaction, so it gets longer than a read.
const tracerTimeoutMs = 15_000;

function refuse(code: `cli.${string}`, message: string, chain: ChainRef): BinferenceError {
  return new BinferenceError({ code, message, details: { chain } });
}

/**
 * The relays a chain's transactions go to: every relay the chain lists, or those config names,
 * each by its name in the chain's list or as an https URL of a relay of its own.
 */
export function relayEndpointsOf(
  chain: RegisteredChain,
  configured: readonly string[] | undefined,
): readonly RpcEndpoint[] {
  const { definition } = chain;
  const listed = definition.relays.map(({ name, url }) => ({ name, url }));
  if (configured === undefined || configured.length === 0) {
    return listed;
  }
  return configured.map((entry) => {
    const named = listed.find((relay) => relay.name === entry);
    if (named !== undefined) {
      return named;
    }
    const url = URL.parse(entry);
    if (url?.protocol !== "https:") {
      const message = `The relay ${entry} is no relay of ${definition.key}.`;
      throw refuse("cli.unknown_relay", message, chain.ref);
    }
    return { name: url.hostname, url: entry };
  });
}

// The owner's tracing RPC of the chain, when config names one; errors name it `tracer` only.
function tracerOf(chain: ChainRef, options: ComposeExecutorOptions) {
  const url = options.tracers?.get(chain);
  return url === undefined
    ? {}
    : {
        tracer: createRpcFailover({
          endpoints: [{ name: "tracer", url }],
          http: options.http,
          clock: options.clock,
          timeoutMs: tracerTimeoutMs,
          restMs: rpcRestMs,
        }),
      };
}

interface ChainParts {
  readonly sending: ChainSending;
  readonly nonces: NonceSource;
}

function chainPartsOf(
  reads: ChainReads,
  options: ComposeExecutorOptions,
  health: RelayHealth,
): ChainParts {
  const { http, clock } = options;
  const { chain, evm, rpc } = reads;
  const relays = relayEndpointsOf(chain, options.relays[chain.ref]);
  const sender = createEvmRelaySender({
    chain: evm,
    relays,
    http,
    clock,
    timeoutMs: relayTimeoutMs,
  });
  return {
    sending: {
      preparer: createEvmTxPreparer({
        rpc,
        chain: evm,
        networkFeeCapWeiPerGas: reads.networkFeeCapWeiPerGas,
      }),
      sender: health.watch(chain.ref, sender),
      receipts: createEvmReceiptReader({
        rpc,
        chain: evm,
        finality: chain.definition.finality,
        ...tracerOf(chain.ref, options),
      }),
    },
    nonces: createEvmNonceSource({ rpc, chain: evm }),
  };
}

/** A nonce source that reads each account's count from its own chain's source. */
export function nonceRouterOf(sources: ReadonlyMap<ChainRef, NonceSource>): NonceSource {
  const sourceOf = (account: AccountRef): NonceSource => {
    const chain = accountRefParts(account).chain;
    const source = sources.get(chain);
    if (source === undefined) {
      throw refuse("cli.no_chain_parts", `No chain parts are set up for ${chain}.`, chain);
    }
    return source;
  };
  return {
    next: async (account, options) => sourceOf(account).next(account, options),
    mined: async (account, options) => sourceOf(account).mined(account, options),
  };
}

/**
 * Builds the executor of a self-hosted engine: for each chain the reads hold, the relay sender
 * over every relay the chain lists or config names (all of them until a measurement picks the
 * fastest), the preparer with the chain's network fee cap, the receipt reader by the chain's
 * finality rule with the owner's tracing RPC when there is one, and the nonce source, all over the
 * chain's one RPC failover; the wallet queue over the stored transactions; custody as the
 * composition gives it.
 */
export function composeExecutor(options: ComposeExecutorOptions): ComposedExecutor {
  const health = createRelayHealth();
  const parts = new Map(
    [...options.reads].map(([chain, reads]) => [chain, chainPartsOf(reads, options, health)]),
  );
  const { stores, clock, random } = options;
  const executor = createExecutor({
    stores,
    positions: options.positions,
    queue: createWalletQueue({
      transactions: stores.transactions,
      nonces: nonceRouterOf(new Map([...parts].map(([chain, part]) => [chain, part.nonces]))),
      clock,
    }),
    custody: options.custody,
    wallets: options.wallets,
    prices: options.prices,
    chains: options.chains,
    venues: options.venues,
    curves: createVenueHost({
      venues: options.venues,
      chains: options.chains,
      clock,
      callTimeoutMs: curveReadTimeoutMs,
    }),
    sending: new Map([...parts].map(([chain, part]) => [chain, part.sending])),
    clock,
    ids: createIdSource({ clock, random }),
    publish: options.publish,
    logger: options.logger,
    ...(options.liveOrderFills === true ? { liveOrderFills: true } : {}),
  });
  return { executor, health: () => health.state() };
}
