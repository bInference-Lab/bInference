import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  chainRefSchema,
  createChainRegistry,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
  createFakeStakingVenue,
  type FakeStakingVenue,
  fakeCallOf,
} from "@binference/chain/testing";
import { bpsSchema, type JsonValue } from "@binference/core";
import type { StakeRequest } from "@binference/protocol";
import { readOf } from "../fakes/fake-ceiling-read.js";
import type { CallCap } from "../install/ceiling-change.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testCoin, testLimits, testNowMs, testWallet } from "../intents/test-intents.js";
import {
  startTestEngine,
  testAccount,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";

/** The fake staking venue's id, which the test agent may use. */
export const testStakingVenue = "fake-staking";
/** A validator that takes stakes. */
export const testValidator: AccountRef = accountRefSchema.parse("fake:1:0x000000c1");
/** A jailed validator. */
export const jailedValidator: AccountRef = accountRefSchema.parse("fake:1:0x000000c2");
/** The fake venue's least stake: a tenth of the coin. */
export const testMinStake: bigint = 10n ** 17n;
/** The fake venue's unbonding time: seven days. */
export const testUnbondingSeconds: number = 7 * 86_400;

const coin = (base: bigint): Amount => ({ asset: testCoin, base });

/** Half of the fake chain's coin, $300 at the test price. */
export const halfCoin: Amount = coin(5n * 10n ** 17n);

/**
 * The fake staking venue on the fake chain, with an active validator that pays `aprBps` a year,
 * 3.5% unless given, and a jailed one.
 */
export function testStakingFake(aprBps = 350): FakeStakingVenue {
  return createFakeStakingVenue({
    validators: [
      { address: "0x000000c1", name: "Active", commissionBps: bpsSchema.parse(700), aprBps },
      { address: "0x000000c2", name: "Jailed", commissionBps: bpsSchema.parse(500), jailed: true },
    ],
    minStakeBase: testMinStake,
    unbondingSeconds: testUnbondingSeconds,
    nowMs: testNowMs,
  });
}

/** The delegate call of a venue that holds a stake to a cap of its own, 100 coins (decision 0325). */
const delegateAbi: JsonValue = {
  type: "function",
  name: "delegate",
  inputs: [],
  outputs: [],
  stateMutability: "payable",
};

/** The fake venue as one that declares its stake call with a cap of its own, as StakeHub does. */
export function withOwnCap(venue: FakeStakingVenue): StakingVenue {
  return {
    ...venue,
    contracts: venue.contracts.map((entry) => ({
      ...entry,
      calls: [
        { contract: "hub", abi: delegateAbi, walletInputs: [], maxValueBase: 100n * 10n ** 18n },
      ],
    })),
  };
}

/** The fake chain's registry with the fake staking venue's contract beside the fake router. */
export function stakingChains(): ReturnType<typeof createChainRegistry> {
  const definition = createFakeChainDefinition();
  const [router] = definition.contracts;
  const hub =
    router === undefined
      ? []
      : [{ ...router, venue: testStakingVenue, name: "hub", address: "0x000000d1" }];
  return createChainRegistry({
    chains: [{ ...definition, contracts: [...definition.contracts, ...hub] }],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

/** The test wallet in the install, under a ceiling of one coin a call and the caps given. */
export function holdStakeWallet(test: TestEngine, ownCaps?: readonly CallCap[]): void {
  const record = testWalletRecord({
    id: testWallet,
    agentId: testAgent,
    label: "main",
    createdAtMs: testNowMs - 1,
  });
  const calls = {
    contracts: [],
    perTxNativeBase: 10n ** 18n,
    ...(ownCaps === undefined ? {} : { ownCaps }),
  };
  const read = readOf([], [chainRefSchema.parse("fake:1")], { calls, bridges: {} });
  test.stores.install.addWallet({
    ...record,
    address: testAccount.slice("fake:1:".length),
    ceiling: { ...record.ceiling, policy: read.policy },
  });
}

/** An engine whose agent may stake on the fake staking venue, paper with five coins unless told. */
export async function startStakeEngine(
  venue: StakingVenue,
  options: TestEngineOptions = {},
): Promise<TestEngine> {
  const limits = { ...testLimits, venues: [...testLimits.venues, testStakingVenue] };
  return startTestEngine({
    chains: stakingChains(),
    stakingVenues: [venue],
    paper: [coin(5n * 10n ** 18n)],
    ...options,
    agent: { limits, ...options.agent },
  });
}

/** A staking request of the test agent with the active validator. */
export function stakeRequest(
  action: StakeRequest["action"],
  change: Partial<StakeRequest> = {},
): StakeRequest {
  return {
    kind: "stake",
    agent: testAgent,
    reason: "Earn on idle coin",
    action,
    venue: testStakingVenue,
    validator: testValidator,
    ...(action === "claim" ? {} : { amount: halfCoin }),
    ...change,
  };
}

/**
 * A simulator that runs each call to the fake staking venue's contract as the chain would, moving
 * its coin from the wallet to the contract, and hands every other draft to `inner`.
 */
export function stakingSimulator(
  inner: Pick<TxSimulator, "simulate">,
): Pick<TxSimulator, "simulate"> {
  const hub = accountRefSchema.parse("fake:1:0x000000d1");
  const run = (draft: TxDraft): SimulatedStep | undefined => {
    const call = fakeCallOf(draft);
    if (call?.to !== "0x000000d1") {
      return undefined;
    }
    const amount = { asset: testCoin, base: call.value };
    const transfers = call.value === 0n ? [] : [{ from: draft.from, to: hub, amount }];
    return { status: "success", gasUsed: 60_000n, transfers, approvals: [] };
  };
  return {
    async simulate(drafts, options) {
      const ran = drafts.map(run);
      const steps = ran.flatMap((step) => (step === undefined ? [] : [step]));
      return steps.length === drafts.length ? steps : inner.simulate(drafts, options);
    },
  };
}

/**
 * The fake staking venue, where the test wallet staked two coins with the active validator, then
 * unstaked one, which is ready to claim.
 */
export async function stakedFake(): Promise<FakeStakingVenue> {
  const fake = testStakingFake();
  const live = { signal: AbortSignal.timeout(1_000) };
  const wallet = testAccount;
  const validator = testValidator;
  const two = { asset: testCoin, base: 2n * 10n ** 18n };
  for (const request of [
    { action: "stake", wallet, validator, amount: two },
    { action: "unstake", wallet, validator, amount: { ...two, base: 10n ** 18n } },
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the unstake takes from the stake
    const planned = await fake.plan(request, live);
    if (!planned.ok) {
      throw new Error(`The fake venue refused the ${request.action}: ${planned.error}.`);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the unstake takes from the stake
    fake.run(await fake.build(planned.value, live));
  }
  fake.wait(testUnbondingSeconds + 1);
  return fake;
}
