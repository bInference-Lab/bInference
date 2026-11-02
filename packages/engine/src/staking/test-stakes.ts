import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  assetRefSchema,
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

/**
 * The fake venue as one that declares its stake call with a cap of its own of 100 coins, as
 * StakeHub's `delegate` and Lista's `deposit` do (decisions 0325 and 0332): by default the fake
 * hub's `delegate`.
 */
export function withOwnCap<T extends StakingVenue>(
  venue: T,
  call: { readonly contract: string; readonly name: string } = {
    contract: "hub",
    name: "delegate",
  },
): T {
  const abi: JsonValue = {
    type: "function",
    name: call.name,
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  };
  const capped = {
    contract: call.contract,
    abi,
    walletInputs: [],
    maxValueBase: 100n * 10n ** 18n,
  };
  return {
    ...venue,
    contracts: venue.contracts.map((entry) => ({ ...entry, calls: [capped] })),
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

// The fake pool's receipt token, which a liquid unstake approves to the pool and then hands it.
const poolReceipt = assetRefSchema.parse("fake:1/token:0x000000e2");

// A liquid unstake's approval of the pool's receipt token to the pool, and the units its request
// hands the pool (decision 0331); the units are the call's last word. A deposit mints the wallet
// receipt units at the test pool's rate of 10 for 11 coins.
function poolEffects(draft: TxDraft, pool: AccountRef) {
  const words = fakeCallOf(draft)?.data.split(",") ?? [];
  const last = words.at(-1) ?? "";
  const amount = { asset: poolReceipt, base: /^\d+$/u.test(last) ? BigInt(last) : 0n };
  if (words[0] === "approve") {
    return { transfers: [], approvals: [{ owner: draft.from, spender: pool, amount }] };
  }
  if (words[0] === "deposit") {
    const minted = { asset: poolReceipt, base: ((fakeCallOf(draft)?.value ?? 0n) * 10n) / 11n };
    return { transfers: [{ from: pool, to: draft.from, amount: minted }], approvals: [] };
  }
  const handed = words[0] === "requestWithdraw" ? [{ from: draft.from, to: pool, amount }] : [];
  return { transfers: handed, approvals: [] };
}

/**
 * A simulator that runs each call to the fake staking venue's contract or the fake pool as the
 * chain would, moving its coin from the wallet to the contract, a stake's receipt units to the
 * wallet, an unstake's approval and receipt units to the pool, and hands every other draft to
 * `inner`.
 */
export function stakingSimulator(
  inner: Pick<TxSimulator, "simulate">,
): Pick<TxSimulator, "simulate"> {
  const pool = accountRefSchema.parse("fake:1:0x000000e1");
  const run = (draft: TxDraft): SimulatedStep | undefined => {
    const call = fakeCallOf(draft);
    const to = call === undefined ? undefined : accountRefSchema.parse(`fake:1:${call.to}`);
    if (
      call === undefined ||
      to === undefined ||
      !["0x000000d1", "0x000000e1", "0x000000e2"].includes(call.to)
    ) {
      return undefined;
    }
    const amount = { asset: testCoin, base: call.value };
    const paid = call.value === 0n ? [] : [{ from: draft.from, to, amount }];
    const pooled =
      call.to === "0x000000d1" ? { transfers: [], approvals: [] } : poolEffects(draft, pool);
    const transfers = [...paid, ...pooled.transfers];
    return { status: "success", gasUsed: 60_000n, transfers, approvals: pooled.approvals };
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
