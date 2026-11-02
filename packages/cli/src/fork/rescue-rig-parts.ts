import {
  accountRefParts,
  assetRefParts,
  type NameResolver,
  type SignRequest,
  type Signer,
} from "@binference/chain";
import {
  createEvmNonceSource,
  createEvmReceiptReader,
  createEvmRelaySender,
  createEvmTxPreparer,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import type { StakingVenue } from "@binference/chain/staking";
import { createIdSource, err, type Id } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import type { EngineOptions, WalletFactsSource } from "@binference/engine";
import {
  createExecutor,
  createStakingHost,
  type ExecutorOptions,
} from "@binference/engine/executor";
import type { WalletRecord } from "@binference/engine/install";
import {
  createFakePriceSource,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
  fixtureId,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import { type Address, erc20Abi, getAddress, type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { SelfHostedBridging } from "../compose/self-hosted-bridging.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkLimits } from "./executor-rig.js";
import { forkCustody } from "./fork-trading.js";

/** One agent wallet of the rescue rig: its ids, its key made from fixed words, its address. */
export interface RescueRigWallet {
  readonly wallet: Id<"wal">;
  readonly agent: Id<"agt">;
  readonly key: Hex;
  readonly address: Address;
  /** `bridge` for the first agent's bridge wallet (decision 0307); absent for a main wallet. */
  readonly role?: "bridge";
}

/**
 * The rig's two agents: the first live with two wallets, its second its bridge wallet, the second
 * on paper with one.
 */
export const rescueAgents: readonly Id<"agt">[] = [fixtureId("agt", 0x61), fixtureId("agt", 0x62)];

function walletOf(n: number, agent: Id<"agt">): RescueRigWallet {
  const key = keccak256(toHex(`binference rescue fork wallet ${String(n)}`));
  return {
    wallet: fixtureId("wal", 0x60 + n),
    agent,
    key,
    address: privateKeyToAccount(key).address,
  };
}

const [firstAgent = fixtureId("agt", 0), secondAgent = fixtureId("agt", 0)] = rescueAgents;
const rigWallets: readonly RescueRigWallet[] = [
  walletOf(1, firstAgent),
  { ...walletOf(2, firstAgent), role: "bridge" },
  walletOf(3, secondAgent),
];

// Custody for the rig: each wallet's key signs for it alone, as a custodian would, and notes each
// request in `asked`.
function rigCustody(fork: Fork, asked: SignRequest[]) {
  const each = new Map(
    rigWallets.map((item) => [
      item.wallet,
      forkCustody(item.wallet, evmAccountRef(fork.chain, item.address), item.key),
    ]),
  );
  return {
    async account(wallet, chain, call) {
      return (await each.get(wallet)?.account(wallet, chain, call)) ?? err("unknown_wallet");
    },
    async signTransaction(request, call) {
      asked.push(request);
      return (
        (await each.get(request.wallet)?.signTransaction(request, call)) ?? err("unknown_wallet")
      );
    },
    signatures: () => [...each.values()].reduce((sum, custody) => sum + custody.signatures(), 0),
  } satisfies Signer & { readonly signatures: () => number };
}

// The wallets' facts as the rig's limits fit them, and what each account holds on the fork now.
function forkWalletFacts(fork: Fork) {
  const agents = new Map(
    rescueAgents.map((agent) => [
      agent,
      rigWallets.filter((item) => item.agent === agent).map(({ wallet }) => wallet),
    ]),
  );
  const facts = {
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    feePerGasNativeBase: 10n ** 9n,
    networkFeeCapNativeBase: 10n ** 10n,
    recentOutflows: [],
  };
  const fake = createFakeWalletFacts(agents, facts);
  return {
    wallets: async (agent, call) => fake.wallets(agent, call),
    // A live wallet's coin is what it holds on the fork, which the gas reserve judges a stake by.
    async facts(query, call) {
      const held = await fake.facts(query, call);
      const address = getAddress(accountRefParts(query.account).address);
      return query.isPaper
        ? held
        : { ...held, nativeBalanceBase: await fork.client.getBalance({ address }) };
    },
    async balances({ account, assets }) {
      const address = getAddress(accountRefParts(account).address);
      return Promise.all(
        assets.map(async (asset) => {
          const { assetNamespace, assetReference } = assetRefParts(asset);
          const base =
            assetNamespace === "slip44"
              ? await fork.client.getBalance({ address })
              : await fork.client.readContract({
                  address: getAddress(assetReference),
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [address],
                });
          return { asset, base };
        }),
      );
    },
  } satisfies WalletFactsSource;
}

function walletRecord(item: RescueRigWallet, atMs: number): WalletRecord {
  const tag = item.wallet.slice(-12);
  return {
    id: item.wallet,
    agentId: item.agent,
    family: "evm",
    custody: "privy",
    custodyWalletId: `privy-wallet-${tag}`,
    policyId: `privy-policy-${tag}`,
    signerId: "privy-agent-quorum",
    address: item.address,
    label: tag,
    createdAtMs: atMs,
    ...(item.role === undefined ? {} : { role: item.role }),
    ceiling: {
      policyId: `privy-policy-${tag}`,
      policy: [{ approve: bscContract("pancakeswap", "v2-router") }],
      perTxNativeBase: 10n ** 18n,
      readAtMs: atMs,
    },
  };
}

// The agents, whose venues add the staking venues the rig runs.
async function storeAgents(
  stores: MemoryEngineStores,
  fork: Fork,
  context: { readonly atMs: number; readonly venues: readonly string[] },
): Promise<void> {
  const call = { signal: AbortSignal.timeout(5_000) };
  const { atMs } = context;
  const limits = forkLimits(fork);
  const base = {
    locale: "en",
    models: {},
    notifications: {},
    atMs,
    limits: { ...limits, venues: [...limits.venues, ...context.venues] },
  } as const;
  const modes = ["live", "paper"] as const;
  await Promise.all(
    rescueAgents.map(async (id, index) =>
      stores.agents.create(
        {
          ...base,
          id,
          name: `rescue ${String(index)}`,
          mode: modes[index] ?? "paper",
          approvalMode: "manual",
          sendLevel: 0,
          bySurface: "cli",
        },
        call,
      ),
    ),
  );
}

// BNB at $600, and each dollar stablecoin at $1.
function rigPrices(fork: Fork) {
  const dollar = { numerator: 1n, denominator: 10n ** 12n };
  return createFakePriceSource(
    new Map([
      [fork.chain.nativeAsset, { numerator: 600n, denominator: 10n ** 12n }],
      [erc20AssetRef(fork.chain, bscToken("USDT")), dollar],
      [erc20AssetRef(fork.chain, bscToken("USDC")), dollar],
    ]),
  );
}

/** What the rig's engine and executor share: names to read and bridges, when given. */
export interface RescueRigReach {
  readonly nameResolvers: readonly NameResolver[];
  readonly bridging?: SelfHostedBridging;
  /** The staking venues the engine and the executor run, whose ids the agents' venues add. */
  readonly stakingVenues?: readonly StakingVenue[];
}

/** The rescue rig's parts on a fork, which an engine is made from. */
export interface RescueRigParts {
  readonly stores: MemoryEngineStores;
  readonly custody: Signer & { readonly signatures: () => number };
  readonly wallets: WalletFactsSource;
  readonly prices: ReturnType<typeof createFakePriceSource>;
  readonly rigWallets: readonly RescueRigWallet[];
  readonly rescue: Address;
  /** What the executor asked the wallets' custody to sign, oldest first. */
  readonly asked: readonly SignRequest[];
  /** The executor on the fork, which sends its pushes and settle messages to `out`. */
  executor(out: RigExecutorOut): ReturnType<typeof createExecutor>;
}

/** Where the rig's executor sends its pushes and, when given, its settle messages. */
interface RigExecutorOut {
  readonly publish: EngineOptions["publish"];
  readonly settled?: ExecutorOptions["settled"];
}

// The executor on the fork: anvil as the one relay, receipts at the finalized tag, and the rig's
// stores, custody, prices, names, bridges and staking venues.
function executorOn(
  fork: Fork,
  parts: Omit<RescueRigParts, "executor" | "rigWallets" | "rescue" | "asked"> & RescueRigReach,
  out: RigExecutorOut,
): ReturnType<typeof createExecutor> {
  const { rpc, chain } = fork;
  const clock = createSystemClock();
  const relays = [{ name: "anvil", url: fork.rpcUrl }];
  const sending = {
    preparer: createEvmTxPreparer({ rpc, chain, networkFeeCapWeiPerGas: 10n ** 10n }),
    sender: createEvmRelaySender({ chain, relays, http: fork.http, clock, timeoutMs: 5_000 }),
    receipts: createEvmReceiptReader({ rpc, chain, finality: { kind: "finalized_tag" } }),
  };
  const nonces = createEvmNonceSource({ rpc, chain });
  return createExecutor({
    stores: parts.stores,
    positions: createMemoryPositionStore(),
    queue: createWalletQueue({ transactions: parts.stores.transactions, nonces, clock }),
    custody: parts.custody,
    wallets: parts.wallets,
    prices: parts.prices,
    chains: selfHostedChains(),
    venues: [],
    sending: new Map([[chain.ref, sending]]),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(61) }),
    publish: out.publish,
    ...(out.settled === undefined ? {} : { settled: out.settled }),
    logger: createMemoryLogger({ subsystem: "engine" }),
    nameResolvers: parts.nameResolvers,
    ...(parts.bridging === undefined ? {} : { bridging: parts.bridging.executor }),
    staking: createStakingHost({
      venues: parts.stakingVenues ?? [],
      chains: selfHostedChains(),
      clock,
    }),
  });
}

/**
 * The rescue rig's parts on a fork: memory stores with two agents and three wallets whose keys
 * sign here, a bridge wallet among them, the owner's rescue address in effect, the wallets' facts
 * over the fork's balances, BNB at $600 and each stablecoin at $1, and an executor that reads a
 * send's name through `reach.nameResolvers`, bridges through `reach.bridging`'s parts and stakes
 * through `reach.stakingVenues`.
 */
export async function rescueRigParts(fork: Fork, reach: RescueRigReach): Promise<RescueRigParts> {
  const clock = createSystemClock();
  const stores = createMemoryEngineStores();
  const asked: SignRequest[] = [];
  const custody = rigCustody(fork, asked);
  const rescue = privateKeyToAccount(keccak256(toHex("binference rescue fork owner"))).address;
  const atMs = clock.now() - 3 * 86_400_000;
  await stores.install.changeRescue(
    { address: evmAccountRef(fork.chain, rescue), atMs },
    { signal: AbortSignal.timeout(5_000) },
  );
  rigWallets.forEach((item) => stores.install.addWallet(walletRecord(item, atMs)));
  const venues = (reach.stakingVenues ?? []).map(({ id }) => id);
  await storeAgents(stores, fork, { atMs, venues });
  const shared = { stores, custody, wallets: forkWalletFacts(fork), prices: rigPrices(fork) };
  return {
    ...shared,
    rigWallets,
    rescue,
    asked,
    executor: (out) => executorOn(fork, { ...shared, ...reach }, out),
  };
}
