import { createBrewVenue } from "@binference/brew";
import type {
  AssetRef,
  ChainRef,
  ChainRegistry,
  PoolHookDefinition,
  PriceFeedDefinition,
  RegisteredChain,
  Venue,
} from "@binference/chain";
import {
  createEvmTxSimulator,
  type CurveChain,
  erc20AssetRef,
  evmAccountRef,
  type EvmChain,
  evmChainOf,
  evmFamilyId,
  parseEvmAddress,
} from "@binference/chain-evm";
import {
  BinferenceError,
  bpsSchema,
  type Clock,
  type Http,
  type Logger,
  type Random,
} from "@binference/core";
import { createFlapVenue, type FlapLaunchChain } from "@binference/flap";
import {
  createGeniusfunVenue,
  type GeniusfunLaunchChain,
  geniusfunLaunchStack,
} from "@binference/geniusfun";
import { createKyberswapVenue, type KyberswapHook } from "@binference/kyberswap";
import { createOkxVenue, type OkxKeys } from "@binference/okx";
import type {
  ChainsConfig,
  OkxKeysConfig,
  VenuesConfig,
} from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { brewOptionsOf } from "./brew-options.js";
import type { ChainReads } from "./chain-reads.js";

/** What the venues are read with. */
export interface ReadVenuesOptions {
  /** The venues' config the engine started with. */
  readonly venues: VenuesConfig;
  /** The venues' config as reloaded, which each venue call reads its settings from. */
  readonly current?: () => VenuesConfig;
  readonly chains: Pick<ChainsConfig, "enabled">;
  readonly registry: ChainRegistry;
  /** The pool hooks routes may pass on each chain, as registry contracts with their fees. */
  readonly poolHooks: ReadonlyMap<ChainRef, readonly PoolHookDefinition[]>;
  /** The price feeds of each chain, whose coin's feed names the chain's wrapped coin. */
  readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
  /** Each enabled chain's reads, whose RPC failover a launchpad reads its contracts through. */
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  readonly secrets: SecretReader;
  readonly http: Http;
  readonly clock: Clock;
  /** The random start of each salt search a Flap or Brew launch makes. */
  readonly random: Random;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

/** The venues the engine quotes on, and the part of them that follows a reload. */
export interface ReadVenues {
  readonly venues: readonly Venue[];
  /**
   * Reads the OKX key again when a reload changed it, for an engine that started with OKX
   * (decision 0230): the next OKX request signs with it, and none once config names none or it
   * cannot be read.
   */
  readonly followReload: (changed: readonly string[], signal: AbortSignal) => Promise<void>;
}

type KeyReading = Pick<ReadVenuesOptions, "secrets" | "logger">;

// The owner's OKX key, or `undefined` when config names none or a part of it cannot be read.
async function okxKeysOf(
  named: OkxKeysConfig | undefined,
  options: KeyReading,
  signal: AbortSignal,
): Promise<OkxKeys | undefined> {
  if (named === undefined) {
    return undefined;
  }
  const { secrets } = options;
  try {
    const [apiKey, secretKey, passphrase] = await Promise.all([
      secrets.read("venues.keys.okx.apiKey", named.apiKey, signal),
      secrets.read("venues.keys.okx.secret", named.secret, signal),
      secrets.read("venues.keys.okx.passphrase", named.passphrase, signal),
    ]);
    return { apiKey, secretKey, passphrase };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("engine.venue_skipped", { errorCode });
    return undefined;
  }
}

// The stablecoins Flap's Portal lists as quote tokens of its curves (`getQuoteTokenConfiguration`),
// read on BNB Smart Chain on 2026-10-12. A chain whose registry lists none of them gives none.
const flapQuoteSymbols: ReadonlySet<string> = new Set(["USDT", "USD1"]);

// The tokens besides the coin Genius.fun's deployment manifest lists as quote tokens of its curves,
// read on BNB Smart Chain on 2026-10-14.
const geniusfunQuoteSymbols: ReadonlySet<string> = new Set(["USDT", "USDC"]);

function quoteTokensOf(
  chain: RegisteredChain,
  evm: EvmChain,
  symbols: ReadonlySet<string>,
): readonly AssetRef[] {
  return chain.definition.tokens
    .filter((token) => symbols.has(token.symbol))
    .flatMap((token) => {
      const address = parseEvmAddress(token.address);
      return address.ok ? [erc20AssetRef(evm, address.value)] : [];
    });
}

// A launchpad on each chain the engine reads, through that chain's one RPC failover, against the
// quote tokens of the given symbols the chain's registry lists.
function curveChainsOf(
  chains: readonly RegisteredChain[],
  reads: ReadonlyMap<ChainRef, ChainReads>,
  symbols: ReadonlySet<string>,
): readonly CurveChain[] {
  return chains.flatMap((chain) => {
    const read = reads.get(chain.ref);
    if (read === undefined) {
      return [];
    }
    const quoteTokens = quoteTokensOf(chain, read.evm, symbols);
    return [{ chain: chain.ref, nativeAsset: read.evm.nativeAsset, quoteTokens, rpc: read.rpc }];
  });
}

// Flap launches on each chain the engine reads whose registry lists Flap's Tax Token V3
// implementation, with a simulator over the chain's RPC failover for its dry runs (decision 0271).
function flapLaunchChainsOf(
  chains: readonly RegisteredChain[],
  reads: ReadonlyMap<ChainRef, ChainReads>,
): readonly FlapLaunchChain[] {
  return chains.flatMap((chain) => {
    const read = reads.get(chain.ref);
    const listed = chain.definition.contracts.find(
      (item) => item.venue === "flap" && item.name === "tax-token-v3-implementation",
    );
    const address = listed === undefined ? undefined : parseEvmAddress(listed.address);
    if (read === undefined || address?.ok !== true) {
      return [];
    }
    return [
      {
        chain: chain.ref,
        simulator: createEvmTxSimulator({ rpc: read.rpc, chain: read.evm }),
        taxTokenImplementation: evmAccountRef(read.evm, address.value),
      },
    ];
  });
}

// Genius.fun launches on each chain the engine reads whose registry lists its m4.2 launch router,
// with a simulator over the chain's RPC failover for its dry runs (decision 0277).
function geniusfunLaunchChainsOf(
  chains: readonly RegisteredChain[],
  reads: ReadonlyMap<ChainRef, ChainReads>,
): readonly GeniusfunLaunchChain[] {
  return chains.flatMap((chain) => {
    const read = reads.get(chain.ref);
    const isListed = chain.definition.contracts.some(
      (item) => item.venue === "geniusfun" && item.name === geniusfunLaunchStack.router,
    );
    return read === undefined || !isListed
      ? []
      : [{ chain: chain.ref, simulator: createEvmTxSimulator({ rpc: read.rpc, chain: read.evm }) }];
  });
}

// The chain's allowed pool hooks, each at its registry address with its fee (decision 0214). A hook
// the registry does not list is a fault of this build.
function allowedHooksOf(
  chain: RegisteredChain,
  hooks: readonly PoolHookDefinition[],
): readonly KyberswapHook[] {
  return hooks.map((hook) => {
    const { contracts } = chain.definition;
    const listed = contracts.find(
      (item) => item.venue === hook.venue && item.name === hook.contract,
    );
    if (listed === undefined) {
      throw new BinferenceError({
        code: "cli.hook_missing",
        message: `The registry of ${chain.ref} lists no hook ${hook.venue}/${hook.contract}.`,
        details: { chain: chain.ref },
      });
    }
    return { address: listed.address, feeBps: bpsSchema.parse(hook.feeBps), maker: hook.maker };
  });
}

/**
 * The venues the self-hosted engine quotes on, on each enabled chain of the EVM family: KyberSwap,
 * keyless, always; the Flap and Genius.fun launchpads, over each chain's RPC failover, always;
 * OKX's DEX aggregator only when `venues.keys.okx` names the owner's key (decision 0105). Flap also
 * launches tax tokens through Flap's own API on each chain the registry lists its implementation
 * on (decision 0271), and Genius.fun launches tokens on each chain the registry lists its m4.2
 * launch router on (decision 0277). Brew, on each chain the registry lists its single-pair factory
 * on, reads its launches for the launch feed, trades nothing itself (decision 0278), and launches
 * tokens against the coin or any registry token (decision 0283). The
 * money path asks every venue an agent allows and keeps the best plan (decision 0107), and sends a
 * token on a launchpad's curve to that launchpad alone (decision 0179). An OKX key that cannot be read is logged and OKX
 * left out: KyberSwap still routes. KyberSwap routes through the pool hooks each chain's allowlist
 * names, with their fees, and drops routes through any other hooked pool (decision 0214).
 */
export async function readVenues(options: ReadVenuesOptions): Promise<ReadVenues> {
  const enabled = options.registry
    .list()
    .filter((chain) => chain.definition.family === evmFamilyId)
    .filter((chain) => options.chains.enabled.includes(chain.ref));
  const chains = enabled.map((chain) => ({
    chain: chain.ref,
    nativeAsset: evmChainOf(chain.definition).nativeAsset,
  }));
  const { http, clock } = options;
  const kyberswap = createKyberswapVenue({
    http,
    clientId: () => (options.current?.() ?? options.venues).kyberClientId,
    chains: enabled.map((chain) => ({
      chain: chain.ref,
      nativeAsset: evmChainOf(chain.definition).nativeAsset,
      allowedHooks: allowedHooksOf(chain, options.poolHooks.get(chain.ref) ?? []),
    })),
  });
  const { reads } = options;
  const flap = createFlapVenue({
    chains: curveChainsOf(enabled, reads, flapQuoteSymbols),
    launches: { http, random: options.random, chains: flapLaunchChainsOf(enabled, reads) },
  });
  const geniusfun = createGeniusfunVenue({
    chains: curveChainsOf(enabled, reads, geniusfunQuoteSymbols),
    launches: { random: options.random, chains: geniusfunLaunchChainsOf(enabled, reads) },
  });
  const brew = createBrewVenue(brewOptionsOf(enabled, { ...options, reads }));
  const held = { keys: await okxKeysOf(options.venues.keys.okx, options, options.signal) };
  if (held.keys === undefined) {
    return {
      venues: [kyberswap, flap, geniusfun, brew],
      followReload: async () => Promise.resolve(),
    };
  }
  const okx = createOkxVenue({ http, clock, keys: () => held.keys, chains });
  return {
    venues: [kyberswap, flap, geniusfun, brew, okx],
    async followReload(changed, signal) {
      if (changed.some((path) => path.startsWith("venues.keys.okx"))) {
        const named = (options.current?.() ?? options.venues).keys.okx;
        held.keys = await okxKeysOf(named, options, signal);
      }
    },
  };
}
