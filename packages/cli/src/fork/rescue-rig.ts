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
  createEvmTxSimulator,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { createIdSource, err, type Id } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type WalletFactsSource,
} from "@binference/engine";
import { createExecutor, type ExecutorOptions } from "@binference/engine/executor";
import type { WalletRecord } from "@binference/engine/install";
import { createSourceMarketReads } from "@binference/engine/market";
import {
  createFakeCeilingEditor,
  createFakeWalletMaker,
  createFakePriceSource,
  createFakeRiskCheck,
  createFakeSimulator,
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
import { forkEngineBasics } from "./fork-engine-basics.js";
import { forkCustody } from "./fork-trading.js";

/** One agent wallet of the rescue rig: its ids, its key made from fixed words, its address. */
interface RescueRigWallet {
  readonly wallet: Id<"wal">;
  readonly agent: Id<"agt">;
  readonly key: Hex;
  readonly address: Address;
  /** `bridge` for the first agent's bridge wallet (decision 0307); absent for a main wallet. */
  readonly role?: "bridge";
}

/** The rescue rig's engine on the fork, its stores, wallets and the owner's rescue address. */
export interface RescueRig {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly wallets: readonly RescueRigWallet[];
  readonly rescue: Address;
  /** How many signatures the wallets' custody made. */
  readonly signatures: () => number;
  /** What the executor asked the wallets' custody to sign, oldest first. */
  readonly asked: readonly SignRequest[];
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
    facts: async (query, call) => fake.facts(query, call),
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

/** What the rig's executor shares with its engine: stores, custody, prices, names and bridges. */
type RigShared = Pick<ExecutorOptions, "stores" | "custody" | "prices" | "nameResolvers"> & {
  readonly bridging?: SelfHostedBridging;
};

function executorOn(fork: Fork, parts: RigShared) {
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
    wallets: forkWalletFacts(fork),
    prices: parts.prices,
    chains: selfHostedChains(),
    venues: [],
    sending: new Map([[chain.ref, sending]]),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(61) }),
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
    ...(parts.nameResolvers === undefined ? {} : { nameResolvers: parts.nameResolvers }),
    ...(parts.bridging === undefined ? {} : { bridging: parts.bridging.executor }),
  });
}

async function storeAgents(stores: MemoryEngineStores, fork: Fork, atMs: number): Promise<void> {
  const call = { signal: AbortSignal.timeout(5_000) };
  const base = {
    locale: "en",
    models: {},
    notifications: {},
    atMs,
    limits: forkLimits(fork),
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

/**
 * The rescue rig on a fork: an engine and its executor on memory stores and the fork's BSC, with
 * two agents, three wallets whose keys sign here, a bridge wallet among them, and the owner's
 * rescue address in effect. Its executor checks a send again at the engine's prices, and both read
 * a send's name through `nameResolvers`, none when absent, and bridge through `bridging`'s parts.
 */
export async function rescueRigOf(
  fork: Fork,
  nameResolvers: readonly NameResolver[] = [],
  bridging?: SelfHostedBridging,
): Promise<RescueRig> {
  const clock = createSystemClock();
  const stores = createMemoryEngineStores();
  const asked: SignRequest[] = [];
  const custody = rigCustody(fork, asked);
  const chains = selfHostedChains();
  const rescue = privateKeyToAccount(keccak256(toHex("binference rescue fork owner"))).address;
  const atMs = clock.now() - 3 * 86_400_000;
  await stores.install.changeRescue(
    { address: evmAccountRef(fork.chain, rescue), atMs },
    { signal: AbortSignal.timeout(5_000) },
  );
  rigWallets.forEach((item) => stores.install.addWallet(walletRecord(item, atMs)));
  await storeAgents(stores, fork, atMs);
  const priceSource = rigPrices(fork);
  const shared = {
    stores,
    custody,
    prices: priceSource,
    nameResolvers,
    ...(bridging === undefined ? {} : { bridging }),
  };
  const engine = createEngine({
    stores,
    positions: createMemoryPositionStore(),
    custody,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: fork.chain.ref, family: "evm" }),
    prices: priceSource,
    wallets: forkWalletFacts(fork),
    // The rig rescues on a fork; it reads no market data.
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
    host: createVenueHost({ venues: [], chains, clock, callTimeoutMs: 5_000 }),
    risk: createFakeRiskCheck({ chains, clock }),
    simulator: createFakeSimulator(new Map()),
    chainSimulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    executor: executorOn(fork, shared),
    nameResolvers,
    ...bridging?.engine,
    ...forkEngineBasics(fork, 62),
  });
  return { engine, stores, wallets: rigWallets, rescue, signatures: custody.signatures, asked };
}
