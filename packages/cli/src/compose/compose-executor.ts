import {
  accountRefParts,
  type ChainDefinition,
  type ChainRef,
  type ChainRegistry,
  type NonceSource,
  type PriceSource,
  type RegisteredChain,
  type Signer,
} from "@binference/chain";
import {
  createEvmNonceSource,
  createEvmReceiptReader,
  createEvmRelaySender,
  createEvmTxPreparer,
  createRpcFailover,
  evmChainOf,
  evmFamilyId,
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
import type {
  EnginePush,
  EngineStores,
  PositionStore,
  WalletFactsSource,
} from "@binference/engine";
import {
  type ChainSending,
  createExecutor,
  type RunningExecutor,
} from "@binference/engine/executor";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import type { ChainsConfig, RpcConfig } from "../config/schema/chains-venues.schema.js";
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
  readonly config: ChainsConfig;
  /** Outbound HTTP for the chains' RPCs and relays. */
  readonly http: Http;
  readonly clock: Clock;
  readonly random: Random;
  readonly publish: (push: EnginePush) => void;
  readonly logger: Logger;
}

// A node gets 5 s to answer a read and rests 30 s after a failure; a relay gets 3 s, several BSC
// blocks, to take a transaction.
const rpcTimeoutMs = 5_000;
const rpcRestMs = 30_000;
const relayTimeoutMs = 3_000;
const gweiText = /^(\d+)(?:\.(\d{1,9}))?$/;
const weiPerGwei = 1_000_000_000n;

function refuse(code: `cli.${string}`, message: string, chain: ChainRef): BinferenceError {
  return new BinferenceError({ code, message, details: { chain } });
}

/** A fee cap in gwei, as config writes it, in wei: at most nine decimals. */
export function gweiToWei(text: string, chain: ChainRef): bigint {
  const [, whole, fraction = ""] = gweiText.exec(text) ?? [];
  if (whole === undefined) {
    throw refuse("cli.bad_fee_cap", `The network fee cap of ${chain} is not gwei.`, chain);
  }
  return BigInt(whole) * weiPerGwei + BigInt(fraction.padEnd(9, "0"));
}

/** The chain's RPCs: those config names first, then the chain's public ones. */
export function rpcEndpointsOf(
  definition: ChainDefinition,
  rpc: RpcConfig | undefined,
): readonly RpcEndpoint[] {
  const configured = (rpc?.urls ?? []).map((url, index): RpcEndpoint => ({
    name: `config-${String(index + 1)}`,
    url,
  }));
  return [...configured, ...definition.rpcs.map(({ name, url }) => ({ name, url }))];
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

interface ChainParts {
  readonly sending: ChainSending;
  readonly nonces: NonceSource;
}

function chainPartsOf(
  chain: RegisteredChain,
  options: ComposeExecutorOptions,
  health: RelayHealth,
): ChainParts {
  const { http, clock, config } = options;
  const { definition } = chain;
  const evm = evmChainOf(definition);
  const endpoints = rpcEndpointsOf(definition, config.rpc[chain.ref]);
  const rpc = createRpcFailover({
    endpoints,
    http,
    clock,
    timeoutMs: rpcTimeoutMs,
    restMs: rpcRestMs,
  });
  const capText = config.maxFeePerGasGwei[chain.ref];
  if (capText === undefined) {
    throw refuse("cli.no_fee_cap", `No network fee cap is set for ${chain.ref}.`, chain.ref);
  }
  const relays = relayEndpointsOf(chain, config.relays[chain.ref]);
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
        networkFeeCap: gweiToWei(capText, chain.ref),
      }),
      sender: health.watch(chain.ref, sender),
      receipts: createEvmReceiptReader({ rpc, chain: evm, finality: definition.finality }),
    },
    nonces: createEvmNonceSource({ rpc, chain: evm }),
  };
}

/** A nonce source that reads each account's count from its own chain's source. */
export function nonceRouterOf(sources: ReadonlyMap<ChainRef, NonceSource>): NonceSource {
  return {
    async next(account, options) {
      const chain = accountRefParts(account).chain;
      const source = sources.get(chain);
      if (source === undefined) {
        throw refuse("cli.no_chain_parts", `No chain parts are set up for ${chain}.`, chain);
      }
      return source.next(account, options);
    },
  };
}

/**
 * Builds the executor of a self-hosted engine: for each enabled chain of the EVM family, the RPC
 * failover over config's RPCs and the chain's public ones, the relay sender over every relay the
 * chain lists or config names (all of them until a measurement picks the fastest), the preparer
 * with config's network fee cap, the receipt reader by the chain's finality rule and the nonce
 * source; the wallet queue over the stored transactions; custody as the composition gives it.
 */
export function composeExecutor(options: ComposeExecutorOptions): ComposedExecutor {
  const health = createRelayHealth();
  const enabled = options.chains
    .list()
    .filter((chain) => chain.definition.family === evmFamilyId)
    .filter((chain) => options.config.enabled.includes(chain.ref));
  const parts = new Map(enabled.map((chain) => [chain.ref, chainPartsOf(chain, options, health)]));
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
    sending: new Map([...parts].map(([chain, part]) => [chain, part.sending])),
    clock,
    ids: createIdSource({ clock, random }),
    publish: options.publish,
    logger: options.logger,
  });
  return { executor, health: () => health.state() };
}
