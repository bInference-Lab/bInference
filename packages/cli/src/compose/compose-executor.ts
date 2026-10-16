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
  /**
   * The relays config names for each chain as they stand now; every relay the chain lists when it
   * names none.
   */
  readonly relays: () => ChainsConfig["relays"];
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
function tracerOf(chain: ChainRef, options: SendingOptions) {
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

/** What a chain's sending parts are built over. */
type SendingOptions = Pick<ComposeExecutorOptions, "relays" | "tracers" | "http" | "clock">;

// What a chain's sending parts are built from: its relays and its fee cap as they stand now.
interface SendingTerms {
  readonly relays: readonly string[] | undefined;
  readonly feeCapWeiPerGas: bigint;
}

/**
 * One chain's sending parts for the next intent run (decision 0230): the relay sender and the
 * preparer are built again only when the chain's relays or fee cap changed, so a run under way
 * keeps the parts it read when it started; the receipt reader stays.
 */
export function followingSending(
  reads: ChainReads,
  options: SendingOptions,
  health: RelayHealth,
): () => ChainSending {
  const { http, clock } = options;
  const { chain, evm, rpc } = reads;
  const receipts = createEvmReceiptReader({
    rpc,
    chain: evm,
    finality: chain.definition.finality,
    ...tracerOf(chain.ref, options),
  });
  const build = (terms: SendingTerms): ChainSending => {
    const relays = relayEndpointsOf(chain, terms.relays);
    const sender = createEvmRelaySender({
      chain: evm,
      relays,
      http,
      clock,
      timeoutMs: relayTimeoutMs,
    });
    const networkFeeCapWeiPerGas = terms.feeCapWeiPerGas;
    const preparer = createEvmTxPreparer({ rpc, chain: evm, networkFeeCapWeiPerGas });
    return { preparer, sender: health.watch(chain.ref, sender), receipts };
  };
  const held: { key?: string; sending?: ChainSending } = {};
  return () => {
    const terms = {
      relays: options.relays()[chain.ref],
      feeCapWeiPerGas: reads.networkFeeCapWeiPerGas(),
    };
    const key = JSON.stringify({ relays: terms.relays, cap: String(terms.feeCapWeiPerGas) });
    if (held.sending === undefined || held.key !== key) {
      held.sending = build(terms);
      held.key = key;
    }
    return held.sending;
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
 * fastest) and the preparer with the chain's network fee cap, both as config holds them when an
 * intent run starts, the receipt reader by the chain's
 * finality rule with the owner's tracing RPC when there is one, and the nonce source, all over the
 * chain's one RPC failover; the wallet queue over the stored transactions; custody as the
 * composition gives it.
 */
export function composeExecutor(options: ComposeExecutorOptions): ComposedExecutor {
  const health = createRelayHealth();
  const sendings = new Map(
    [...options.reads].map(([chain, reads]) => [chain, followingSending(reads, options, health)]),
  );
  const nonces = new Map(
    [...options.reads].map(([chain, { rpc, evm }]) => [
      chain,
      createEvmNonceSource({ rpc, chain: evm }),
    ]),
  );
  const { stores, clock, random } = options;
  const executor = createExecutor({
    stores,
    positions: options.positions,
    queue: createWalletQueue({
      transactions: stores.transactions,
      nonces: nonceRouterOf(nonces),
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
    sending: { get: (chain) => sendings.get(chain)?.() },
    clock,
    ids: createIdSource({ clock, random }),
    publish: options.publish,
    logger: options.logger,
    ...(options.liveOrderFills === true ? { liveOrderFills: true } : {}),
  });
  return { executor, health: () => health.state() };
}
