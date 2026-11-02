import type { TxDraft, TxHash } from "@binference/chain";
import type { StakePlan, StakeRefusal, StakingVenue } from "@binference/chain/staking";
import type { FakeStakingVenue } from "@binference/chain/testing";
import { err, type Id, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { cardLineText, createFormatter } from "@binference/i18n";
import { receiptLine } from "../confirmations/card-closing.js";
import { testCoin, testLimits, testNowMs } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import {
  holdStakeWallet,
  stakingChains,
  stakingSimulator,
  testStakingVenue,
  testValidator,
} from "../staking/test-stakes.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import { createStakingHost } from "../venues/staking-host.js";
import { type BenchOptions, type ExecutorBench, startExecutorBench } from "./test-executor.js";

const live = { signal: new AbortController().signal };

/** The states a staking move the bench runs ends in. */
export const stakeEnds = [
  "reconciled",
  "failed_check",
  "failed_onchain",
  "expired",
  "cancelled",
] as const;

/** A staking venue a test makes refuse every move, or stop answering, from a moment on. */
export interface RefusableVenue {
  readonly answer: {
    refusal?: StakeRefusal;
    isDown?: boolean;
    /** Changes each plan the venue answers, as a venue that plans another move than asked. */
    mangle?: (plan: StakePlan) => StakePlan;
  };
  readonly venue: StakingVenue;
}

/** The venue as it answers now: its own plans until a test sets `answer`. */
export function refusable(venue: StakingVenue): RefusableVenue {
  const answer: RefusableVenue["answer"] = {};
  const wrapped: StakingVenue = {
    ...venue,
    plan: async (request, call) => {
      if (answer.isDown === true) {
        throw new Error("The venue does not answer.");
      }
      if (answer.refusal !== undefined) {
        return err(answer.refusal);
      }
      const planned = await venue.plan(request, call);
      return planned.ok && answer.mangle !== undefined ? ok(answer.mangle(planned.value)) : planned;
    },
  };
  return { answer, venue: wrapped };
}

/** An unstake of `base` of the coin's worth that the test wallet signed somewhere else. */
export async function unstakeElsewhere(fake: FakeStakingVenue, base: bigint): Promise<void> {
  const amount = { asset: testCoin, base };
  const ask = { action: "unstake", wallet: testAccount, validator: testValidator, amount } as const;
  const planned = await fake.plan(ask, live);
  if (!planned.ok) {
    throw new Error(`The fake venue refused the unstake: ${planned.error}.`);
  }
  fake.run(await fake.build(planned.value, live));
}

/**
 * The fake venue as the bench's chain lands its moves: the bench's network runs no venue, so the
 * first read-back of a transaction the venue did not run itself runs the move it built last on the
 * fake, once, and reads that back. Drafts a test runs through `run` read back as their own.
 */
export function landing(
  fake: FakeStakingVenue,
): StakingVenue & Pick<FakeStakingVenue, "run" | "wait"> {
  const built: { drafts: readonly TxDraft[] } = { drafts: [] };
  const ran = new Map<TxHash, TxHash>();
  const runOnce = (drafts: readonly TxDraft[]): readonly TxHash[] => {
    built.drafts = [];
    const hashes = fake.run(drafts);
    hashes.forEach((hash) => ran.set(hash, hash));
    return hashes;
  };
  return {
    ...fake,
    build: async (plan, call) => {
      built.drafts = await fake.build(plan, call);
      return built.drafts;
    },
    landed: async (move, call) => {
      const own = ran.get(move.hash) ?? runOnce(built.drafts)[0];
      if (own !== undefined) {
        ran.set(move.hash, own);
      }
      return fake.landed({ ...move, hash: own ?? move.hash }, call);
    },
    run: runOnce,
  };
}

/** A live agent that may stake on the venue, its wallet under a ceiling, its moves held at the queue. */
export async function stakeBench(
  venue: StakingVenue,
  options: Pick<BenchOptions, "limits"> = {},
): Promise<ExecutorBench> {
  const chains = stakingChains();
  const staking = createStakingHost({
    venues: [venue],
    chains,
    clock: createManualClock(testNowMs),
  });
  const failing = { simulate: async () => Promise.reject(new Error("Only staking calls run.")) };
  const bench = await startExecutorBench({
    ...options,
    hold: true,
    agent: { limits: { ...testLimits, venues: [...testLimits.venues, testStakingVenue] } },
    engine: { chains, stakingVenues: [venue], chainSimulator: stakingSimulator(failing) },
    routing: { chains, staking },
  });
  holdStakeWallet(bench.test);
  return bench;
}

/** The reason the intent stored. */
export async function stakeReasonOf(
  bench: ExecutorBench,
  intent: Id<"int">,
): Promise<string | undefined> {
  return (await bench.test.stores.intents.get(intent, live))?.reason;
}

/** The receipt of the intent's card as the owner's chat and the console show it, in a language. */
export async function stakeReceiptOf(
  bench: ExecutorBench,
  intent: Id<"int">,
  locale: "en" | "zh",
): Promise<string> {
  const showings = createCardShowings({
    ...bench.test.stores,
    chains: stakingChains(),
    venues: { hasNoDeadline: () => false },
  });
  const settled = await showings.settled(intent, live);
  if (settled?.live === undefined) {
    throw new Error("The card has no receipt.");
  }
  const display = {
    formatter: createFormatter({ locale, timeZone: "UTC" }),
    assets: settled.live.assets,
  };
  return cardLineText(receiptLine(settled.closing, settled.live.outcome), display);
}
