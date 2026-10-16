import type { AssetRef, Signer, TokenRiskReport, Venue } from "@binference/chain";
import {
  createEvmNonceSource,
  createEvmReceiptReader,
  createEvmRelaySender,
  createEvmTxPreparer,
  createEvmTxSimulator,
  erc20AssetRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError, createIdSource, type Id } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import {
  createPrivyApi,
  createPrivyOwnerSigner,
  type PrivyApi,
  privyApiOrigin,
  type PrivyWallet,
} from "@binference/custody-privy";
import { createFakePrivy } from "@binference/custody-privy/testing";
import {
  createEngine,
  type Engine,
  type PositionStore,
  type VenueHost,
  type WalletFactsSource,
} from "@binference/engine";
import { createExecutor } from "@binference/engine/executor";
import type { CustodyRecord, WalletMaker } from "@binference/engine/install";
import { createSourceMarketReads } from "@binference/engine/market";
import { createRiskCheck } from "@binference/engine/risk";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakePriceSource,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import { createGeniusfunVenue } from "@binference/geniusfun";
import {
  createP256KeyPair,
  formatAgentKey,
  formatOwnerKeyCode,
  type SignerRefusalNotice,
} from "@binference/signer";
import { createChainWalletFacts } from "../compose/chain-wallet-facts.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createPrivyWalletMaker } from "../compose/privy-wallet-maker.js";
import { type StartedSigner, startSignerProcess } from "../compose/start-signer.js";
import { ceilingChainsOf, heldCapsOf } from "../compose/wallet-ceilings.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkEngineBasics } from "./fork-engine-basics.js";

/** The fee cap the rig's signer and preparer hold: 10 gwei. */
const feeCapWei = 10n ** 10n;

/**
 * The install's custody on the Privy fake: its keys, the signer with the agent key, and the Privy
 * wallets the adapter signs for, by the engine's id.
 */
export interface RigCustody {
  readonly api: PrivyApi;
  readonly signer: StartedSigner;
  readonly record: CustodyRecord;
  readonly ownerKey: string;
  readonly wallets: Map<Id<"wal">, PrivyWallet>;
  readonly refusals: SignerRefusalNotice[];
}

/**
 * Custody on a fresh Privy fake: the owner and agent keys, each a key quorum there, and the signer
 * process from the bundle at `entry`, holding the agent key and reporting each refusal.
 */
export async function custodyOn(
  fork: Fork,
  entry: string,
  signal: AbortSignal,
): Promise<RigCustody> {
  const clock = createSystemClock();
  const privy = createFakePrivy({ clock, random: createSeededRandom(217) });
  const { appId, appSecret } = privy;
  const api = createPrivyApi({ http: privy.http, clock, appId, appSecret });
  const [ownerPair, agentPair] = [createP256KeyPair(), createP256KeyPair()];
  const refusals: SignerRefusalNotice[] = [];
  const chain = fork.chain.ref;
  const signer = await startSignerProcess({
    entry,
    settings: {
      chains: [chain],
      privyApi: privyApiOrigin,
      networkFeeCaps: [{ chain, feePerGasBase: feeCapWei }],
    },
    agentKey: formatAgentKey(agentPair),
    env: process.env,
    logger: createMemoryLogger({ subsystem: "engine" }),
    onRefusal: (notice) => refusals.push(notice),
    signal,
  });
  const [ownerQuorum, agentQuorum] = await Promise.all(
    [ownerPair, agentPair].map(async ({ publicKey }) =>
      api.createKeyQuorum({ publicKey, displayName: "binference fork" }, { signal }),
    ),
  );
  const record: CustodyRecord = {
    provider: "privy",
    appId,
    ownerQuorumId: ownerQuorum?.id ?? "",
    ownerKeyPublic: ownerPair.publicKey,
    agentQuorumId: agentQuorum?.id ?? "",
    agentKeyPublic: agentPair.publicKey,
    attachedAtMs: clock.now(),
  };
  const ownerKey = formatOwnerKeyCode(ownerPair).reveal();
  return { api, signer, record, ownerKey, wallets: new Map(), refusals };
}

/**
 * The wallet maker as the CLI composes it: each ceiling as init plans it for the venues named, and
 * a launch wallet's with the launch rules of every launchpad the install runs.
 */
export function walletMakerOf(
  custody: RigCustody,
  parts: { readonly stores: MemoryEngineStores; readonly venues: readonly Venue[] },
): ReturnType<typeof createPrivyWalletMaker> {
  const config = configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
  });
  const plans = { chains: selfHostedChains(), config, venues: parts.venues };
  return createPrivyWalletMaker({
    api: custody.api,
    clock: createSystemClock(),
    custody: async () => Promise.resolve(custody.record),
    ceilingChains: (wallet) => ceilingChainsOf(plans, wallet),
    heldCaps: async (signal) => heldCapsOf(parts.stores.install, signal),
    onMade: (wallet, made) => custody.wallets.set(wallet, made),
  });
}

/** Genius.fun on the fork, against BNB and the registry's USDT and USDC, as the CLI runs it. */
export function geniusfunOn(fork: Fork): Venue {
  const { ref: chain, nativeAsset } = fork.chain;
  const quoteTokens = [bscToken("USDT"), bscToken("USDC")].map((token) =>
    erc20AssetRef(fork.chain, token),
  );
  return createGeniusfunVenue({ chains: [{ chain, nativeAsset, quoteTokens, rpc: fork.rpc }] });
}

/** The wallets' facts as the self-hosted engine reads them, from the install and the fork. */
export function walletFactsOn(
  fork: Fork,
  stores: MemoryEngineStores,
): ReturnType<typeof createChainWalletFacts> {
  const chain = selfHostedChains()
    .list()
    .find((item) => item.ref === fork.chain.ref);
  if (chain === undefined) {
    throw new BinferenceError({ code: "fork.no_chain", message: "The registry lacks the fork." });
  }
  const multicall = bscContract("multicall3", "multicall3");
  const reads = { chain, evm: fork.chain, rpc: fork.rpc, networkFeeCapWeiPerGas: () => feeCapWei };
  return createChainWalletFacts({
    install: stores.install,
    intents: stores.intents,
    reads: new Map([[fork.chain.ref, { ...reads, multicall }]]),
    clock: createSystemClock(),
  });
}

/** What the rig's engine and executor share. */
export interface RigParts {
  readonly fork: Fork;
  readonly stores: MemoryEngineStores;
  readonly positions: PositionStore;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly venue: Venue;
  readonly host: VenueHost;
  /** The tokens the risk source reports on, each with deep liquidity and no flag. */
  readonly covered: readonly AssetRef[];
}

function executorOf(parts: RigParts) {
  const { fork, stores } = parts;
  const { rpc, chain } = fork;
  const clock = createSystemClock();
  const relays = [{ name: "anvil", url: fork.rpcUrl }];
  const sending = {
    preparer: createEvmTxPreparer({ rpc, chain, networkFeeCapWeiPerGas: feeCapWei }),
    sender: createEvmRelaySender({ chain, relays, http: fork.http, clock, timeoutMs: 5_000 }),
    receipts: createEvmReceiptReader({ rpc, chain, finality: { kind: "finalized_tag" } }),
  };
  const prices = new Map([[chain.nativeAsset, { numerator: 600n, denominator: 10n ** 12n }]]);
  return createExecutor({
    ...parts,
    queue: createWalletQueue({
      transactions: stores.transactions,
      nonces: createEvmNonceSource({ rpc, chain }),
      clock,
    }),
    prices: createFakePriceSource(prices),
    chains: selfHostedChains(),
    venues: [parts.venue],
    curves: parts.host,
    sending: new Map([[chain.ref, sending]]),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(2171) }),
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
}

const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 10n ** 15n };

// The engine's own risk step over the fork: a source that reports on the covered tokens alone,
// and the round trip of each trade simulated on the fork through the venue it quotes.
function riskOn(parts: RigParts) {
  const { fork, host, covered } = parts;
  const source = createFakeRiskSource({
    id: "goplus",
    reports: new Map(covered.map((token) => [token, deep])),
  });
  return createRiskCheck({
    sources: [{ source, isRequired: true }],
    cache: createMemoryRiskCacheStore(["goplus"]),
    cacheTtlMs: () => 600_000,
    sourceTimeoutMs: 15_000,
    host,
    simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    chains: selfHostedChains(),
    clock: createSystemClock(),
    random: createSeededRandom(2174),
  });
}

/** The engine on the fork, its executor beside it, making wallets with the maker given. */
export function engineOf(parts: RigParts, walletMaker: WalletMaker): Engine {
  const { fork, host } = parts;
  const { rpc, chain } = fork;
  const chains = selfHostedChains();
  const clock = createSystemClock();
  const prices = new Map([[chain.nativeAsset, { numerator: 600n, denominator: 10n ** 12n }]]);
  return createEngine({
    ...parts,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker,
    prices: createFakePriceSource(prices),
    // The rig trades on a fork; it reads no market data.
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
    host,
    risk: riskOn(parts),
    simulator: createSimulationCheck({
      simulator: createEvmTxSimulator({ rpc, chain }),
      chains,
      clock,
    }),
    chainSimulator: createEvmTxSimulator({ rpc, chain }),
    executor: executorOf(parts),
    ...forkEngineBasics(fork, 2172),
  });
}

/** The adapter the engine signs through: the real signer process over the Privy fake. */
export function signerOver(custody: RigCustody): ReturnType<typeof createPrivyOwnerSigner> {
  return createPrivyOwnerSigner({
    api: custody.api,
    signerProcess: custody.signer.client,
    walletOf: (wallet) => custody.wallets.get(wallet),
  });
}
