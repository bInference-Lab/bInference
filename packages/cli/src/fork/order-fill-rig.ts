import type { AssetRef, RiskFlagCode } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { type Fork, withFork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { createIdSource, type Id, idSchema } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import {
  createEngine,
  createVenueHost,
  type Engine,
  type EngineCaller,
  type EnginePush,
  type VenueHost,
} from "@binference/engine";
import { createSourceMarketReads } from "@binference/engine/market";
import { createRiskCheck } from "@binference/engine/risk";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakeExecutor,
  createFakePriceSource,
  createFakeWalletFacts,
  createFakeWalletMaker,
  createMemoryEngineStores,
  createMemoryPositionStore,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
  testWalletRecord,
} from "@binference/engine/testing";
import type { OrderRequest } from "@binference/protocol";
import { type Address, getAddress, keccak256, toHex } from "viem";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkLimits } from "./executor-rig.js";
import { createFeeTokenVenue } from "./fee-token-venue.js";
import { forkCustody, forkTokenFacts, forkWallet } from "./fork-trading.js";

/** A key made from fixed words: the order rig's wallet, which holds nothing on BSC. */
const walletKey: `0x${string}` = keccak256(toHex("binference order fill fork wallet"));
/** The rig's paper agent and its one wallet. */
export const fillAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-000000000052",
);
const fillWallet: Id<"wal"> = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000052");

/**
 * SPA, a live BSC token checked on chain with GoPlus and honeypot.is on 2026-10-09: it trades on
 * its PancakeSwap v2 pair with USDT, yet most of its holders' sales fail in TransferHelper, and a
 * buy sends part of what it bought on out of the buyer's wallet.
 */
export const spa: Address = getAddress("0xE77E41c26B6460Afccb9971CA11Fa968647c43B7");

/** Venus (XVS), a clean token on its PancakeSwap v2 pair with WBNB that the registry does not list. */
export const xvs: Address = getAddress("0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63");

/** The token a fork test's orders trade, the token its pair routes through, and its risk flags. */
export interface FillFixture {
  readonly token: Address;
  /** The other token of its PancakeSwap v2 pair, when that is not WBNB. */
  readonly via?: Address;
  /** What the risk source reports of it; nothing when it finds it clean. */
  readonly flags: readonly RiskFlagCode[];
}

/** The owner's CLI, as the server signs it in. */
const cliCaller: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000052",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

/** A paper engine on the suite's fork, with what a test reads of it. */
export interface FillRig {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly pushes: readonly EnginePush[];
  readonly token: AssetRef;
}

// The risk step on the fork: one required source that reports the fixture's flags, and the test
// trades simulated on the fork.
function riskOf(fork: Fork, parts: { readonly host: VenueHost; readonly fixture: FillFixture }) {
  const chains = selfHostedChains();
  const clock = createSystemClock();
  const token = erc20AssetRef(fork.chain, parts.fixture.token);
  const deep = { flags: parts.fixture.flags, liquidityUsdMicros: 10n ** 15n };
  return createRiskCheck({
    sources: [
      {
        source: createFakeRiskSource({ id: "goplus", reports: new Map([[token, deep]]) }),
        isRequired: true,
      },
    ],
    cache: createMemoryRiskCacheStore(["goplus"]),
    cacheTtlMs: 600_000,
    sourceTimeoutMs: 15_000,
    host: parts.host,
    simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    chains,
    clock,
    random: createSeededRandom(53),
  });
}

// What the wallet facts say of the rig's wallet: 1 BNB, and a fee per gas under the cap.
const walletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 10n ** 9n,
  networkFeeCapNativeBase: 10n ** 9n,
  recentOutflows: [],
};

function engineOf(
  fork: Fork,
  parts: { readonly pushes: EnginePush[]; readonly fixture: FillFixture },
): { readonly engine: Engine; readonly stores: MemoryEngineStores } {
  const { pushes, fixture } = parts;
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const native = fork.chain.nativeAsset;
  const { rpc, chain } = fork;
  const stores = createMemoryEngineStores();
  const routes =
    fixture.via === undefined ? [] : [[erc20AssetRef(chain, fixture.token), fixture.via] as const];
  const via = new Map(routes);
  const venue = createFeeTokenVenue({ fork, nativeAsset: native, via });
  const host = createVenueHost({ venues: [venue], chains, clock, callTimeoutMs: 15_000 });
  const account = evmAccountRef(chain, forkWallet(walletKey).address);
  const engine = createEngine({
    stores,
    positions: createMemoryPositionStore(),
    custody: forkCustody(fillWallet, account, walletKey),
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: chain.ref, family: "evm" }),
    prices: createFakePriceSource(
      new Map([[native, { numerator: 600n, denominator: 10n ** 12n }]]),
    ),
    wallets: createFakeWalletFacts(new Map([[fillAgent, [fillWallet]]]), walletFacts),
    host,
    risk: riskOf(fork, { host, fixture }),
    simulator: createSimulationCheck({
      simulator: createEvmTxSimulator({ rpc, chain }),
      chains,
      clock,
    }),
    chainSimulator: createEvmTxSimulator({ rpc, chain }),
    executor: createFakeExecutor(),
    // The rig trades on a fork; it reads no market data.
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
    paperBalances: [{ asset: native, base: 10n ** 18n }],
    isLocked: () => false,
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: forkTokenFacts(fork),
    chains,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(52) }),
    random: createSeededRandom(54),
    publish: (push) => pushes.push(push),
    ownerTimeZone: () => "UTC",
  });
  return { engine, stores };
}

// The paper agent with its wallet stored, and its paper portfolio of 1 BNB.
async function seed(fork: Fork, rig: Pick<FillRig, "engine" | "stores">): Promise<void> {
  const signal = AbortSignal.timeout(10_000);
  const atMs = createSystemClock().now();
  await rig.stores.agents.create(
    {
      id: fillAgent,
      name: "fork",
      mode: "paper",
      locale: "en",
      models: {},
      notifications: {},
      atMs,
      limits: forkLimits(fork),
      approvalMode: "manual",
      sendLevel: 0,
      bySurface: "cli",
    },
    { signal },
  );
  rig.stores.install.addWallet(
    testWalletRecord({ id: fillWallet, agentId: fillAgent, label: "main", createdAtMs: atMs }),
  );
  const balances = [{ asset: fork.chain.nativeAsset, base: 10n ** 18n }];
  await rig.engine.handlers["portfolio/resetPaper"]({
    args: { agent: fillAgent, balances },
    caller: cliCaller,
    signal,
  });
}

/**
 * Runs `test` with a paper engine on the suite's fork that trades the fixture's token, whose
 * changes the fork undoes after.
 */
export async function onFillFork(
  signal: AbortSignal,
  fixture: FillFixture,
  test: (rig: FillRig, fork: Fork) => Promise<void>,
): Promise<void> {
  await withFork(signal, async (fork) => {
    const pushes: EnginePush[] = [];
    const { engine, stores } = engineOf(fork, { pushes, fixture });
    const rig = { engine, stores, pushes, token: erc20AssetRef(fork.chain, fixture.token) };
    await seed(fork, rig);
    await test(rig, fork);
  });
}

/**
 * An order created from the owner's CLI and confirmed on its card from Telegram, as the owner
 * makes one active; answers its id.
 */
export async function confirmedOrder(
  rig: FillRig,
  request: OrderRequest,
  signal: AbortSignal,
): Promise<Id<"ord">> {
  const created = await rig.engine.handlers["order/create"]({
    args: request,
    caller: cliCaller,
    signal,
  });
  if (!created.ok || created.value.intent === undefined) {
    throw new Error("Expected the order to wait for its card.");
  }
  const { order, intent } = created.value;
  const answeredBy = { surface: "telegram", by: "telegram" } as const;
  const answered = await rig.engine.answer(
    { intent, decision: "confirm", cardVersion: 1, answeredBy },
    { signal },
  );
  if (!answered.ok) {
    throw new Error(`Expected the order's card to take the Confirm: ${answered.error}.`);
  }
  return order;
}
