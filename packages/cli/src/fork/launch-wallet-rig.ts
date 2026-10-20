import { accountRefParts, type Venue } from "@binference/chain";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { BinferenceError, createSecret, type Id, idSchema } from "@binference/core";
import {
  createLaunchHost,
  createVenueHost,
  type Engine,
  type PositionStore,
} from "@binference/engine";
import type { WalletMaker } from "@binference/engine/install";
import {
  createMemoryEngineStores,
  createMemoryLaunchImages,
  createMemoryPositionStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import type { SignerRefusalNotice } from "@binference/signer";
import { type Address, getAddress, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { selfHostedChains, selfHostedUnboundFirstBuys } from "../compose/open-engine-parts.js";
import { chainTokenCode } from "../compose/token-facts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkLimits } from "./executor-rig.js";
import {
  custodyOn,
  engineOf,
  geniusfunOn,
  type RigCustody,
  signerOver,
  walletFactsOn,
  walletMakerOf,
} from "./launch-wallet-parts.js";

/** A wallet of the rig's agent: its engine id and its address on the fork. */
interface LaunchRigWallet {
  readonly wallet: Id<"wal">;
  readonly address: Address;
}

/**
 * The launch wallet rig on a fork: the engine and its executor, custody on the Privy fake under
 * the ceilings binference builds, signed for by the real signer process, one live agent trading
 * on Genius.fun with the main wallet init made and the launch wallet the owner key made with
 * `wallet/create`, and the owner's rescue address in effect.
 */
export interface LaunchRig extends LaunchAgent {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly positions: PositionStore;
  /** Each step the signer refused, as it reported it. */
  readonly refusals: readonly SignerRefusalNotice[];
  /** Stops the signer process. */
  stop(): Promise<void>;
}

/** The owner as the rig's CLI calls the engine: over IPC, with every scope. */
export const rigOwner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000217",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "loosen", "admin"],
  transport: "ipc",
} as const;

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000217");
const mainWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000217");
const rescue = privateKeyToAccount(
  keccak256(toHex("binference launch wallet fork rescue")),
).address;
/** What each of the agent's wallets holds of BNB when the rig starts: 0.05 BNB. */
export const rigFunding: bigint = 5n * 10n ** 16n;

// The rig's one agent: live, trading on the rig's launchpads under the fork limits, asking for
// each trade.
async function storeAgent(
  stores: MemoryEngineStores,
  parts: { readonly fork: Fork; readonly venues: readonly string[] },
  signal: AbortSignal,
) {
  const limits = { ...forkLimits(parts.fork), venues: [...parts.venues] };
  const draft = { locale: "en", models: {}, notifications: {}, limits, sendLevel: 0 } as const;
  await stores.agents.create(
    {
      ...draft,
      id: agent,
      name: "curves",
      mode: "live",
      atMs: createSystemClock().now(),
      approvalMode: "manual",
      bySurface: "cli",
    },
    { signal },
  );
}

function refused(code: `fork.${string}`, problem: string): BinferenceError {
  return new BinferenceError({
    code,
    message: "The rig could not be set up.",
    details: { problem },
  });
}

// The install as init leaves it: custody, the rescue address in effect, and the agent's main
// wallet, which the maker made under the ceiling init plans.
async function setUpInstall(
  parts: {
    readonly fork: Fork;
    readonly stores: MemoryEngineStores;
    readonly maker: WalletMaker;
    readonly venues: readonly string[];
  },
  custody: RigCustody,
  signal: AbortSignal,
): Promise<LaunchRigWallet> {
  const rescueAddress = evmAccountRef(parts.fork.chain, rescue);
  const request = {
    wallet: mainWallet,
    ownerKey: createSecret(custody.ownerKey),
    venues: parts.venues,
    recipients: [rescueAddress],
    isLaunch: false,
  };
  const made = await parts.maker.make(request, { signal });
  if (!made.ok) {
    throw refused("fork.no_wallet", made.error);
  }
  const atMs = createSystemClock().now();
  const wallet = { ...made.value.record, id: mainWallet, agentId: agent, label: "main" };
  const setup = { atMs, custody: custody.record, rescueAddress, isStartOver: false };
  const set = await parts.stores.install.setUp(
    { ...setup, wallet: { ...wallet, createdAtMs: atMs } },
    { signal },
  );
  if (!set.ok) {
    throw refused("fork.no_install", set.error);
  }
  return { wallet: mainWallet, address: getAddress(made.value.record.address) };
}

// The agent's launch wallet, made as `binference wallet create --launch` makes it.
async function createLaunchWallet(
  engine: Pick<Engine, "handlers">,
  custody: RigCustody,
  signal: AbortSignal,
) {
  const args = { agent, label: "curves", ownerKey: custody.ownerKey, launch: true } as const;
  const created = await engine.handlers["wallet/create"]({ args, caller: rigOwner, signal });
  if (!created.ok) {
    throw refused("fork.no_launch_wallet", created.error);
  }
  const { wallet, address } = created.value;
  return { wallet, address: getAddress(accountRefParts(address).address) };
}

// Each wallet starts with the rig's BNB and no code; the rescue address with nothing.
async function fund(fork: Fork, wallets: readonly LaunchRigWallet[]): Promise<void> {
  const addresses = wallets.map(({ address }) => address);
  await Promise.all(
    [...addresses, rescue].map(async (address) => fork.call("anvil_setCode", [address, "0x"])),
  );
  await Promise.all([
    ...addresses.map(async (address) =>
      fork.call("anvil_setBalance", [address, toHex(rigFunding)]),
    ),
    fork.call("anvil_setBalance", [rescue, "0x0"]),
  ]);
}

/** The rig's live agent with its main wallet, its launch wallet and the rescue address in effect. */
interface LaunchAgent {
  readonly agent: Id<"agt">;
  readonly main: LaunchRigWallet;
  readonly launch: LaunchRigWallet;
  readonly rescue: Address;
}

/**
 * Sets the rig's install up on an engine as init and `binference wallet create --launch` leave
 * it: the live agent trading on the venues named, custody with the rescue address in effect, the
 * main wallet and the launch wallet, each holding the rig's BNB on the fork.
 */
async function setUpLaunchAgent(
  parts: {
    readonly fork: Fork;
    readonly stores: MemoryEngineStores;
    readonly maker: WalletMaker;
    readonly engine: Pick<Engine, "handlers">;
    readonly custody: RigCustody;
    readonly venues: readonly string[];
  },
  signal: AbortSignal,
): Promise<LaunchAgent> {
  const { fork, stores, maker, engine, custody, venues } = parts;
  await storeAgent(stores, { fork, venues }, signal);
  const main = await setUpInstall({ fork, stores, maker, venues }, custody, signal);
  const launch = await createLaunchWallet(engine, custody, signal);
  await fund(fork, [main, launch]);
  return { agent, main, launch, rescue };
}

/** A launchpad the rig also launches tokens on, and the owner's pictures, by upload id. */
export interface RigLauncher {
  readonly venue: Venue;
  readonly images: ReadonlyMap<string, Readonly<Uint8Array>>;
}

// What the engine's token launches need on the fork: the launch host over the rig's venues, a
// code read through the fork, and the owner's pictures, each uploaded by the rig's CLI owner.
function launchingOf(fork: Fork, venues: readonly Venue[], launcher: RigLauncher) {
  const chains = selfHostedChains();
  const clock = createSystemClock();
  return {
    launchHost: createLaunchHost({
      venues,
      chains,
      clock,
      callTimeoutMs: 15_000,
      unboundFirstBuys: selfHostedUnboundFirstBuys(),
    }),
    launchTokenCode: chainTokenCode(new Map([[fork.chain.ref, { rpc: fork.rpc }]])),
    launchImages: createMemoryLaunchImages(launcher.images, rigOwner.credential),
  };
}

/**
 * The launch wallet rig on `fork`, its signer run from the bundle at `entry`, its risk source
 * reporting on `token` alone, trading on Genius.fun and, given one, launching on `launcher` too.
 * A rig that fails to set up stops its signer; a test stops it with {@link LaunchRig.stop} once
 * done.
 */
export async function launchRigOf(
  fork: Fork,
  run: { readonly entry: string; readonly token?: Address; readonly launcher?: RigLauncher },
  signal: AbortSignal,
): Promise<LaunchRig> {
  const stores = createMemoryEngineStores();
  const positions = createMemoryPositionStore();
  const custody = await custodyOn(fork, run.entry, signal);
  // A Genius.fun launcher is the rig's Genius.fun venue itself; any other launches beside it.
  const launcher = run.launcher?.venue;
  const venues =
    launcher?.id === "geniusfun"
      ? [launcher]
      : [geniusfunOn(fork), ...(launcher === undefined ? [] : [launcher])];
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 15_000 });
  const maker = walletMakerOf(custody, { stores, venues });
  const wallets = walletFactsOn(fork, stores);
  const covered = run.token === undefined ? [] : [erc20AssetRef(fork.chain, run.token)];
  const signer = signerOver(custody);
  const launching =
    run.launcher === undefined ? {} : { launching: launchingOf(fork, venues, run.launcher) };
  const parts = { fork, stores, positions, custody: signer, wallets, venues, host, covered };
  const engine = engineOf({ ...parts, ...launching }, maker);
  const ids = venues.map((venue) => venue.id);
  try {
    const install = { fork, stores, maker, engine, custody, venues: ids };
    const agentSet = await setUpLaunchAgent(install, signal);
    const { refusals } = custody;
    const stop = async () => custody.signer.stop(AbortSignal.timeout(5_000));
    return { engine, stores, positions, ...agentSet, refusals, stop };
  } catch (error) {
    await custody.signer.stop(AbortSignal.abort());
    throw error;
  }
}
