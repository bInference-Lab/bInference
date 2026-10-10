import { type AccountRef, accountRefParts, assetRefParts, type Signer } from "@binference/chain";
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
import { createIdSource, err, type Id, idSchema } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type WalletFactsSource,
} from "@binference/engine";
import { createExecutor } from "@binference/engine/executor";
import type { WalletRecord } from "@binference/engine/install";
import {
  createFakeCeilingEditor,
  createFakeWalletMaker,
  createFakePriceSource,
  createFakeRiskCheck,
  createFakeSimulator,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import { createWalletQueue } from "@binference/engine/wallet-queue";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkLimits } from "./executor-rig.js";
import { forkCustody } from "./fork-trading.js";

/** One agent wallet of the rescue rig: its ids, its key made from fixed words, its address. */
export interface RescueRigWallet {
  readonly wallet: Id<"wal">;
  readonly agent: Id<"agt">;
  readonly key: Hex;
  readonly address: Address;
}

/** The rescue rig's engine on the fork, its stores, wallets and the owner's rescue address. */
export interface RescueRig {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly wallets: readonly RescueRigWallet[];
  readonly rescue: Address;
  /** How many signatures the wallets' custody made. */
  readonly signatures: () => number;
}

function idOf<P extends string>(prefix: P, n: number): Id<P> {
  return idSchema(prefix).parse(
    `${prefix}_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
  );
}

/** The rig's two agents: the first live with two wallets, the second on paper with one. */
export const rescueAgents: readonly Id<"agt">[] = [idOf("agt", 0x61), idOf("agt", 0x62)];

function walletOf(n: number, agent: Id<"agt">): RescueRigWallet {
  const key = keccak256(toHex(`binference rescue fork wallet ${String(n)}`));
  return { wallet: idOf("wal", 0x60 + n), agent, key, address: privateKeyToAccount(key).address };
}

const [firstAgent = idOf("agt", 0), secondAgent = idOf("agt", 0)] = rescueAgents;
const rigWallets: readonly RescueRigWallet[] = [
  walletOf(1, firstAgent),
  walletOf(2, firstAgent),
  walletOf(3, secondAgent),
];

// Custody for the rig: each wallet's key signs for it alone, as a custodian would.
function rigCustody(fork: Fork) {
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
    ceiling: {
      policyId: `privy-policy-${tag}`,
      policy: [],
      perTxNativeBase: 10n ** 18n,
      readAtMs: atMs,
    },
  };
}

function executorOn(
  fork: Fork,
  parts: { readonly stores: MemoryEngineStores; readonly custody: Signer },
) {
  const { rpc, chain } = fork;
  const clock = createSystemClock();
  const relays = [{ name: "anvil", url: fork.rpcUrl }];
  const sending = {
    preparer: createEvmTxPreparer({ rpc, chain, networkFeeCap: 10n ** 10n }),
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
    prices: createFakePriceSource(new Map()),
    chains: selfHostedChains(),
    sending: new Map([[chain.ref, sending]]),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(61) }),
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
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

/**
 * The rescue rig on a fork: an engine and its executor on memory stores and the fork's BSC, with
 * two agents, three wallets whose keys sign here, and the owner's rescue address in effect.
 */
export async function rescueRigOf(fork: Fork): Promise<RescueRig> {
  const clock = createSystemClock();
  const stores = createMemoryEngineStores();
  const custody = rigCustody(fork);
  const chains = selfHostedChains();
  const rescue = privateKeyToAccount(keccak256(toHex("binference rescue fork owner"))).address;
  const atMs = clock.now() - 3 * 86_400_000;
  await stores.install.changeRescue(
    { address: evmAccountRef(fork.chain, rescue), atMs },
    { signal: AbortSignal.timeout(5_000) },
  );
  rigWallets.forEach((item) => stores.install.addWallet(walletRecord(item, atMs)));
  await storeAgents(stores, fork, atMs);
  const prices = new Map([
    [fork.chain.nativeAsset, { numerator: 600n, denominator: 10n ** 12n }],
    [erc20AssetRef(fork.chain, bscToken("USDT")), { numerator: 1n, denominator: 10n ** 12n }],
  ]);
  const engine = createEngine({
    stores,
    positions: createMemoryPositionStore(),
    custody,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: fork.chain.ref, family: "evm" }),
    prices: createFakePriceSource(prices),
    wallets: forkWalletFacts(fork),
    host: createVenueHost({ venues: [], chains, clock, callTimeoutMs: 5_000 }),
    risk: createFakeRiskCheck({ chains, clock }),
    simulator: createFakeSimulator(new Map()),
    chainSimulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    executor: executorOn(fork, { stores, custody }),
    paperBalances: [],
    isLocked: () => false,
    chains,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(62) }),
    random: createSeededRandom(63),
    publish: () => undefined,
  });
  return { engine, stores, wallets: rigWallets, rescue, signatures: custody.signatures };
}

const swapAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

/** Buys `token` with `value` of the fork account's BNB on PancakeSwap's v2 router, for `to`. */
export async function buyFor(
  fork: Fork,
  purchase: { readonly token: Address; readonly to: Address; readonly value: bigint },
): Promise<void> {
  const data = encodeFunctionData({
    abi: swapAbi,
    functionName: "swapExactETHForTokens",
    args: [
      0n,
      [bscToken("WBNB"), purchase.token],
      purchase.to,
      BigInt(Math.floor(Date.now() / 1_000) + 600),
    ],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: fork.account, to: router, value: purchase.value, data });
}

/** What an account holds on the fork of BNB and of a token. */
export async function heldOn(
  fork: Fork,
  account: { readonly address: Address; readonly token: Address },
): Promise<{ readonly coin: bigint; readonly token: bigint }> {
  const { address, token } = account;
  const [coin, held] = await Promise.all([
    fork.client.getBalance({ address }),
    fork.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  return { coin, token: held };
}

/** The account of an address on the fork's chain. */
export function accountOn(fork: Fork, address: Address): AccountRef {
  return evmAccountRef(fork.chain, address);
}
