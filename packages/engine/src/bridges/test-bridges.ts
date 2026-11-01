import {
  type AccountRef,
  accountRefSchema,
  type AddressCodec,
  type Amount,
  type AssetRef,
  assetRefSchema,
  type Bridge,
  type ChainRef,
  chainRefSchema,
  createChainRegistry,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/chain";
import {
  createFakeAccountCodeReader,
  createFakeAddressCodec,
  createFakeBridge,
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
  type FakeAccountCodeReader,
  type FakeBridge,
  type FakeDeliveryReader,
  createFakeDeliveryReader,
  fakeCallOf,
} from "@binference/chain/testing";
import { bpsSchema, err, idSchema, ok } from "@binference/core";
import type { BridgeRequest } from "@binference/protocol";
import type { DestinationChain } from "../address-book/destination-chain.js";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { LimitsValues } from "../agents/limits-record.js";
import { readOf } from "../fakes/fake-ceiling-read.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  testAgent,
  testLimits,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  testAccount,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress } from "../send-levels/test-sends.js";
import type { BridgeRoute, HostedBridge } from "./hosted-bridge.js";

const live = { signal: new AbortController().signal };

/**
 * A test family's codec of addresses written as `length` bytes of lowercase hex after `0x`: 20
 * bytes as an EVM chain's, 32 as Solana's recipients carry.
 */
export function testHexCodec(namespace: string, length: number): AddressCodec {
  const form = new RegExp(`^0x[0-9a-f]{${String(length * 2)}}$`, "u");
  return {
    namespace,
    recipientLength: length,
    parse: (text) => (form.test(text) ? ok(text) : err("malformed_address")),
    toBytes: (text) =>
      form.test(text)
        ? ok(Uint8Array.from(Buffer.from(text.slice(2), "hex")))
        : err("malformed_address"),
    fromBytes: (bytes) =>
      bytes.length === length
        ? ok(`0x${Buffer.from(bytes).toString("hex")}`)
        : err("malformed_address"),
  };
}

/** The chain the fake bridge delivers to. */
export const testDestination: ChainRef = chainRefSchema.parse("fake:2");
/** The token the fake bridge's route delivers there. */
export const testArrives: AssetRef = assetRefSchema.parse("fake:2/token:0x000000f3");
/** Another token of the destination, which a route may deliver in place of the one sent. */
export const testOtherArrives: AssetRef = assetRefSchema.parse("fake:2/token:0x000000f4");
/** The fake bridge's spoke on the fake chain, which every deposit calls and approvals name. */
export const testSpoke: AccountRef = accountRefSchema.parse("fake:1:0x000000e1");
/** The owner's rescue address on the fake chain. */
export const testRescue: AccountRef = accountRefSchema.parse("fake:1:0x000000d9");
/** The rescue address on the destination, where a bridge pays it once it holds no code. */
export const testRescueThere: AccountRef = accountRefSchema.parse("fake:2:0x000000d9");

/** An address the owner saved for the destination two days before the test starts. */
export const testFarEntry: AddressEntryRecord = {
  id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-0000000000b1"),
  agentId: testAgent,
  account: accountRefSchema.parse("fake:2:0x000000b1"),
  recipientBytes: "0x000000b1",
  label: "exchange",
  usableAtMs: testNowMs - looseningWaitMs,
  inCeilingAtMs: testNowMs - 2 * looseningWaitMs,
  createdAtMs: testNowMs - 2 * looseningWaitMs,
};

/** The fake bridge's one route, from the fake chain's token to the destination's, 6 decimals each. */
export const testRoute: BridgeRoute = {
  leaves: testToken,
  arrives: testArrives,
  decimals: { leaves: 6, arrives: 6 },
};

/** The destination as the engine takes it, its code read through `codes`. */
export function testDestinationChain(codes: FakeAccountCodeReader): DestinationChain {
  return {
    ref: testDestination,
    name: "Fake Two",
    assets: {
      [testArrives]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
      [testOtherArrives]: { symbol: "TKG", name: "Global token", decimals: 6, verified: true },
    },
    codec: createFakeAddressCodec(),
    codes,
  };
}

// A fake approval sets the allowance of the token it calls for the spender its words name.
function approvalStep(to: string, words: readonly string[]): SimulatedStep {
  const [, spender = "", base = "0"] = words;
  const amount = { asset: assetRefSchema.parse(`fake:1/token:${to}`), base: BigInt(base) };
  const approval = {
    owner: testAccount,
    spender: accountRefSchema.parse(`fake:1:${spender}`),
    amount,
  };
  return { status: "success", gasUsed: 40_000n, transfers: [], approvals: [approval] };
}

// A fake bridge deposit moves its amount in from the test wallet to the contract it calls.
function depositStep(to: string, words: readonly string[]): SimulatedStep {
  const [, , base = "0", asset = ""] = words;
  const amount: Amount = { asset: assetRefSchema.parse(asset), base: BigInt(base) };
  const transfer = { from: testAccount, to: accountRefSchema.parse(`fake:1:${to}`), amount };
  return { status: "success", gasUsed: 90_000n, transfers: [transfer], approvals: [] };
}

const revertedStep: SimulatedStep = {
  status: "reverted",
  gasUsed: 1n,
  transfers: [],
  approvals: [],
};

// What one fake draft does when it runs: an approval, a deposit, or a revert for anything else.
function stepOf(draft: Parameters<TxSimulator["simulate"]>[0][number]): SimulatedStep {
  const call = fakeCallOf(draft);
  const words = call?.data.split(",") ?? [];
  const steps: Readonly<Record<string, (to: string, words: readonly string[]) => SimulatedStep>> = {
    approve: approvalStep,
    deposit: depositStep,
  };
  const step = steps[words[0] ?? ""];
  return call === undefined || step === undefined ? revertedStep : step(call.to, words);
}

/** A simulator that runs fake approvals and fake bridge deposits from the test wallet. */
function bridgeSimulator(): Pick<TxSimulator, "simulate"> {
  return {
    async simulate(drafts, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(drafts.map(stepOf));
    },
  };
}

/** A bridge of `amount` of the fake token, 100 by default, from the test wallet to `to`. */
export function testBridge(
  to: BridgeRequest["to"] = { entry: testFarEntry.id },
  amount: Amount = { asset: testToken, base: 100_000_000n },
): BridgeRequest {
  return {
    kind: "bridge",
    agent: testAgent,
    wallet: testWallet,
    reason: "Move to the exchange",
    amount,
    toChain: testDestination,
    to,
  };
}

/**
 * The test limits with the fake bridge among the venues and a 2% slippage limit, above the 1% the
 * fake bridge keeps.
 */
export const bridgeLimits: LimitsValues = {
  ...testLimits,
  slippageRegistryBps: bpsSchema.parse(200),
  venues: ["fake-swap", "fake-cross"],
};

/** What a bridge test changes from the live bridge engine's defaults. */
export interface BridgeEngineOptions extends TestEngineOptions {
  /** The bridge the engine runs; the fake bridge on its routes when absent. */
  readonly bridge?: Bridge;
  /** The routes the bridge serves; the fake bridge's one route when absent. */
  readonly routes?: readonly BridgeRoute[];
  /** The accounts the test wallet's ceiling's bridge rules pay; the entry and the rescue there. */
  readonly bridged?: readonly AccountRef[];
}

/** A live engine with its fakes, where a test drives the bridge's code reads and deposits. */
export interface BridgeTest {
  readonly test: TestEngine;
  readonly bridge: FakeBridge;
  /** The code read on the fake chain, where the rescue address holds none unless a test says. */
  readonly codesHere: FakeAccountCodeReader;
  /** The code read on the destination. */
  readonly codesThere: FakeAccountCodeReader;
}

// The test wallet in the install, under a ceiling whose bridge rules pay the accounts given and
// whose 24-hour caps name the fake token.
function holdBridgeWallet(test: TestEngine, bridged: readonly AccountRef[]): void {
  const record = testWalletRecord({
    id: testWallet,
    agentId: testAgent,
    label: "main",
    createdAtMs: testNowMs - 1,
  });
  const dayCaps = [
    { asset: testToken, limit: 10n ** 12n, windowSeconds: 86_400, floorUsdMicros: 0n },
  ];
  const read = readOf([testRescue, ...bridged], [chainRefSchema.parse("fake:1")], {
    calls: { contracts: [testSpoke], perTxNativeBase: 10n ** 18n, dayCaps },
    bridges: {},
  });
  test.stores.install.addWallet({
    ...record,
    address: testAccount.slice("fake:1:".length),
    ceiling: { ...record.ceiling, policy: read.policy },
  });
}

/** The fakes a bridge test drives: the bridge, its routes, the code reads and the registry. */
export interface BridgeFakes {
  readonly bridge: FakeBridge;
  readonly hosted: HostedBridge;
  /** The code read on the fake chain, where the rescue address holds none unless a test says. */
  readonly codesHere: FakeAccountCodeReader;
  /** The code read on the destination. */
  readonly codesThere: FakeAccountCodeReader;
  /** The deliveries read on the fake chain, where a refund lands. */
  readonly landsHere: FakeDeliveryReader;
  /** The deliveries read on the destination, where a fill lands. */
  readonly landsThere: FakeDeliveryReader;
  /** The fake chain's registry, which lists the fake bridge's spoke beside the fake venue's router. */
  readonly chains: ReturnType<typeof createChainRegistry>;
}

/** The fakes of a bridge test, its bridge and routes as the options name them. */
export function bridgeFakes(
  options: Pick<BridgeEngineOptions, "bridge" | "routes"> = {},
): BridgeFakes {
  const routes = options.routes ?? [testRoute];
  const bridge = createFakeBridge({ routes, quotedAtMs: testNowMs });
  const definition = createFakeChainDefinition();
  const [router] = definition.contracts;
  const spoke =
    router === undefined
      ? []
      : [{ ...router, venue: "fake-cross", name: "spoke", address: "0x000000e1" }];
  return {
    bridge,
    hosted: { bridge: options.bridge ?? bridge, routes },
    codesHere: createFakeAccountCodeReader({ chain: chainRefSchema.parse("fake:1") }),
    codesThere: createFakeAccountCodeReader({ chain: testDestination }),
    landsHere: createFakeDeliveryReader(chainRefSchema.parse("fake:1")),
    landsThere: createFakeDeliveryReader(testDestination),
    chains: createChainRegistry({
      chains: [{ ...definition, contracts: [...definition.contracts, ...spoke] }],
      families: [createFakeFamily()],
      signingSchemes: [createFakeSigningScheme()],
    }),
  };
}

/**
 * The options of a live engine whose agent may use the fake bridge, which delivers the fake token
 * to the destination; the wallet holds 1,000 of the token at $1.
 */
export function bridgeEngineOptions(
  fakes: BridgeFakes,
  options: TestEngineOptions = {},
): TestEngineOptions {
  return {
    agent: { mode: "live", limits: bridgeLimits },
    chains: fakes.chains,
    destinations: [testDestinationChain(fakes.codesThere)],
    bridging: {
      bridges: [fakes.hosted],
      codeReaders: [fakes.codesHere],
      deliveryReaders: [fakes.landsHere, fakes.landsThere],
    },
    prices: new Map([[testToken, { numerator: 1_000_000n, denominator: 1_000_000n }]]),
    held: new Map([[testAccount, [{ asset: testToken, base: 1_000_000_000n }]]]),
    chainSimulator: bridgeSimulator(),
    ...options,
  };
}

/**
 * Sets the rescue address, saves the destination entry and lists the test wallet under a ceiling
 * whose bridge rules pay `bridged`: the entry and the rescue address there by default.
 */
export async function readyBridges(
  test: TestEngine,
  bridged: readonly AccountRef[] = [testFarEntry.account, testRescueThere],
): Promise<void> {
  await test.stores.install.changeRescue(
    { address: testRescue, atMs: testNowMs - 3 * looseningWaitMs },
    live,
  );
  await saveTestAddress(test, testFarEntry);
  holdBridgeWallet(test, bridged);
}

/** Starts a live engine with the bridge fakes, ready to bridge (see `readyBridges`). */
export async function bridgeEngine(options: BridgeEngineOptions = {}): Promise<BridgeTest> {
  const fakes = bridgeFakes(options);
  const { bridge: _bridge, routes: _routes, bridged, ...engine } = options;
  const test = await startTestEngine(bridgeEngineOptions(fakes, engine));
  await readyBridges(test, bridged);
  return { test, bridge: fakes.bridge, codesHere: fakes.codesHere, codesThere: fakes.codesThere };
}
