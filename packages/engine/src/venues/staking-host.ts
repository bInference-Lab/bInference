import {
  type AccountRef,
  accountRefSchema,
  type AmountWire,
  amountSchema,
  type AssetRef,
  assetRefSchema,
  type ChainFamily,
  type ChainRef,
  type ChainRegistry,
  declaredContracts,
  isSameAccount,
  type RegisteredChain,
  type TxDraft,
} from "@binference/chain";
import {
  type LandedRequest,
  type LandedStake,
  landedStakeSchema,
  type ReceiptPool,
  type StakePlan,
  stakePlanSchema,
  type StakeRefusal,
  type StakeRefusalFacts,
  type StakeRequest,
  type StakingOptions,
  type StakingVenue,
  type UnbondingPart,
} from "@binference/chain/staking";
import { type Clock, type Err, err, type Ok, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { BuildMismatch } from "./build-checks.js";
import { callVenue, ownCopy } from "./call-venue.js";
import { declaredSpenders } from "./declared-spenders.js";
import { type LandedMismatch, landedMismatch } from "./landed-checks.js";
import { readCallStep, readEachDraft } from "./read-steps.js";
import { stakeMismatch, type StakePlanStep } from "./stake-checks.js";
import { readStakeOptions } from "./stake-options.js";
import { planMismatch } from "./stake-plan-checks.js";
import { readStakePools } from "./stake-pools.js";

/** Why the host has no plan of a staking move: the venue's refusal, or what the host refused. */
export type StakePlanFailure = StakeRefusal | "venue_down" | "decode_mismatch";

/**
 * The host's plan of a staking move, or why it has none: the venue's refusal with the facts its
 * words name, or the host's, with the check a `decode_mismatch` failed.
 */
export type HostPlanned =
  | Ok<StakePlan>
  | (Err<StakePlanFailure> & {
      readonly facts?: StakeRefusalFacts;
      readonly mismatch?: BuildMismatch;
    });

/** Why the host built no staking call; `mismatch` names the failed check of a `decode_mismatch`. */
type StakeBuilt =
  | Ok<readonly TxDraft[]>
  | (Err<"venue_down" | "decode_mismatch"> & { readonly mismatch?: BuildMismatch });

/**
 * What a landed move did, as the host holds it to its plan, or why it has none: `not_found` for a
 * transaction that holds no such move, `venue_down`, or `decode_mismatch` with the read-back check
 * that failed.
 */
type HostLanded =
  | Ok<LandedStake>
  | (Err<"not_found" | "venue_down" | "decode_mismatch"> & { readonly mismatch?: LandedMismatch });

/**
 * The venue host's part for staking venues (decision 0327): the only caller of their code. Every
 * call runs under the host's timeout, a throw or a timeout is `venue_down`, and what a venue
 * returns is checked and copied before anything reads it.
 */
export interface StakingHost {
  /** The staking venue with this id on the chain, when the engine runs one there. */
  readonly venueOn: (id: string, chain: ChainRef) => StakingVenue | undefined;
  /** Every staking venue the engine runs on the chain, in the order it was given them. */
  readonly venuesOn: (chain: ChainRef) => readonly StakingVenue[];
  /** Every staking venue with this id the engine runs, one per chain. */
  readonly venuesWith: (id: string) => readonly StakingVenue[];
  /**
   * Plans the move, or answers the venue's refusal with the facts its words name. A plan of
   * another move than the request asks is `decode_mismatch` (`other_plan`), and so is an unstake
   * that takes out less than its amount (`short_unstake`).
   */
  plan(
    venue: StakingVenue,
    request: StakeRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<HostPlanned>;
  /**
   * Builds the planned move and holds it to the plan: one call, from the plan's wallet, to a
   * contract the venue declares on the chain, crediting that wallet alone, making the plan's move,
   * after an unstake's exact approval of its receipt units to a spender the venue declares.
   */
  build(
    venue: StakingVenue,
    plan: StakePlan,
    options: { readonly signal: AbortSignal },
  ): Promise<StakeBuilt>;
  /** The receipt token a stake with the validator mints, or the venue's refusal. */
  receipt(
    venue: StakingVenue,
    validator: AccountRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AssetRef, "validator_unknown" | "venue_down">>;
  /** The validators the venue lists now, its unbonding time and least stake, or `venue_down`. */
  options(
    venue: StakingVenue,
    call: { readonly signal: AbortSignal },
  ): Promise<Result<StakingOptions, "venue_down">>;
  /**
   * The pools of the receipts named that the venue mints, at the latest block, each with its
   * validator (decision 0329); an answer the host cannot hold is `venue_down`.
   */
  pools(
    venue: StakingVenue,
    receipts: readonly AssetRef[],
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly ReceiptPool[], "venue_down">>;
  /** The unbonding parts the wallet holds with the validator now, ready or not. */
  parts(
    venue: StakingVenue,
    held: { readonly wallet: AccountRef; readonly validator: AccountRef },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly UnbondingPart[], "venue_down">>;
  /** What a landed move did, read from its transaction and held to the plan the card confirmed. */
  landed(
    venue: StakingVenue,
    landing: { readonly move: LandedRequest; readonly plan: StakePlan },
    options: { readonly signal: AbortSignal },
  ): Promise<HostLanded>;
}

/** What the staking host runs on: the venues, the registry that lists their contracts, a clock. */
export interface StakingHostOptions {
  readonly venues: readonly StakingVenue[];
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

// A staking venue answers within this, or counts as down.
const stakingTimeoutMs = 10_000;

interface RefusalFactsWire {
  readonly minStake?: AmountWire;
  readonly readyAtMs?: number;
}

const refusalFactsSchema: z.ZodType<StakeRefusalFacts, RefusalFactsWire> = z.strictObject({
  minStake: amountSchema.exactOptional(),
  readyAtMs: z.int().nonnegative().exactOptional(),
});

// The venue's declared contracts on the chain, from the registry by name; none for a name the
// registry lacks, which no call may reach.
function contractsOf(venue: StakingVenue, chain: RegisteredChain): readonly AccountRef[] {
  const declared = declaredContracts(venue, chain);
  return declared.ok
    ? declared.value.map((address) => accountRefSchema.parse(`${chain.ref}:${address}`))
    : [];
}

// The chain's family read each draft's approval and the venue's decoder each staking call, each
// from the host's own copy; a draft neither reads, or a decoder that throws, leaves none.
function stepsOf(
  venue: StakingVenue,
  drafts: readonly TxDraft[],
  family: ChainFamily,
): readonly StakePlanStep[] | undefined {
  try {
    const read = readEachDraft(drafts, (draft) =>
      readCallStep(draft, family, (copy): StakePlanStep | undefined => {
        const decoded = venue.decode(copy);
        return decoded.ok
          ? { kind: "stake", draft: copy, decoded: { ...decoded.value } }
          : undefined;
      }),
    );
    return read.ok ? read.value : undefined;
  } catch {
    return undefined;
  }
}

function chainOf(options: StakingHostOptions, venue: StakingVenue): RegisteredChain | undefined {
  const found = options.chains.get(venue.chain);
  return found.ok ? found.value : undefined;
}

function timingOf(options: StakingHostOptions, signal: AbortSignal) {
  return { clock: options.clock, signal, timeoutMs: stakingTimeoutMs };
}

// The venue's refusal, with its facts when they read as facts; facts that do not are left out.
function refusalOf(
  refused: Err<StakeRefusal> & { readonly facts?: StakeRefusalFacts },
): HostPlanned {
  const facts =
    refused.facts === undefined ? undefined : ownCopy(refusalFactsSchema, refused.facts);
  return facts === undefined ? err(refused.error) : { ...err(refused.error), facts };
}

// The venue's plan, copied and held to the request.
async function planWith(
  options: StakingHostOptions,
  venue: StakingVenue,
  call: { readonly request: StakeRequest; readonly signal: AbortSignal },
): Promise<HostPlanned> {
  const { request, signal } = call;
  const planned = await callVenue(
    async (inner) => venue.plan(request, { signal: inner }),
    timingOf(options, signal),
  );
  if (!planned.ok) {
    return planned;
  }
  if (!planned.value.ok) {
    return refusalOf(planned.value);
  }
  const chain = chainOf(options, venue);
  const copy = ownCopy(stakePlanSchema, planned.value.value);
  if (copy === undefined || chain === undefined) {
    return { ...err("decode_mismatch"), mismatch: "other_plan" };
  }
  const mismatch = planMismatch(copy, request, chain.family);
  return mismatch === undefined ? ok(copy) : { ...err("decode_mismatch"), mismatch };
}

// The venue's call, held to the plan by its own decoder.
async function buildWith(
  options: StakingHostOptions,
  venue: StakingVenue,
  call: { readonly plan: StakePlan; readonly signal: AbortSignal },
): Promise<StakeBuilt> {
  const { plan, signal } = call;
  const built = await callVenue(
    async (inner) => venue.build(plan, { signal: inner }),
    timingOf(options, signal),
  );
  if (!built.ok) {
    return err("venue_down");
  }
  const drafts = [...built.value];
  const chain = chainOf(options, venue);
  const steps = chain === undefined ? undefined : stepsOf(venue, drafts, chain.family);
  const bounds =
    chain === undefined
      ? undefined
      : {
          contracts: contractsOf(venue, chain),
          spenders: declaredSpenders(venue, chain),
          family: chain.family,
        };
  const mismatch =
    steps === undefined || bounds === undefined
      ? "unreadable_step"
      : stakeMismatch(steps, plan, bounds);
  return mismatch === undefined
    ? ok(steps?.map((step) => step.draft) ?? [])
    : { ...err("decode_mismatch"), mismatch };
}

// What the landed move did, copied and held to the plan.
async function landedWith(
  options: StakingHostOptions,
  venue: StakingVenue,
  call: { readonly move: LandedRequest; readonly plan: StakePlan; readonly signal: AbortSignal },
): Promise<HostLanded> {
  const { move, plan, signal } = call;
  const read = await callVenue(
    async (inner) => venue.landed(move, { signal: inner }),
    timingOf(options, signal),
  );
  if (!read.ok || !read.value.ok) {
    return read.ok ? read.value : read;
  }
  const chain = chainOf(options, venue);
  const copy = ownCopy(landedStakeSchema, read.value.value);
  if (copy === undefined || chain === undefined) {
    return { ...err("decode_mismatch"), mismatch: "other_move" };
  }
  const mismatch = landedMismatch(copy, plan, chain.family);
  return mismatch === undefined ? ok(copy) : { ...err("decode_mismatch"), mismatch };
}

// The parts the wallet holds with the validator, as the venue reads its holdings now.
async function partsWith(
  options: StakingHostOptions,
  venue: StakingVenue,
  call: {
    readonly wallet: AccountRef;
    readonly validator: AccountRef;
    readonly signal: AbortSignal;
  },
): Promise<Result<readonly UnbondingPart[], "venue_down">> {
  const { wallet, validator, signal } = call;
  const read = await callVenue(
    async (inner) => venue.holdings(wallet, { signal: inner }),
    timingOf(options, signal),
  );
  const chain = chainOf(options, venue);
  if (!read.ok || chain === undefined) {
    return err("venue_down");
  }
  const held = read.value.find((holding) =>
    isSameAccount(holding.validator, validator, chain.family),
  );
  return ok(structuredClone(held?.unbonding ?? []));
}

/** Creates the {@link StakingHost} over the staking venues the engine runs. */
export function createStakingHost(options: StakingHostOptions): StakingHost {
  const { venues } = options;
  return {
    venueOn: (id, chain) => venues.find((venue) => venue.id === id && venue.chain === chain),
    venuesOn: (chain) => venues.filter((venue) => venue.chain === chain),
    venuesWith: (id) => venues.filter((venue) => venue.id === id),
    plan: async (venue, request, { signal }) => planWith(options, venue, { request, signal }),
    build: async (venue, plan, { signal }) => buildWith(options, venue, { plan, signal }),
    async receipt(venue, validator, { signal }) {
      const read = await callVenue(
        async (inner) => venue.receipt(validator, { signal: inner }),
        timingOf(options, signal),
      );
      if (!read.ok || !read.value.ok) {
        return read.ok ? read.value : read;
      }
      const copy = assetRefSchema.safeParse(read.value.value);
      return copy.success ? ok(copy.data) : err("venue_down");
    },
    options: async (venue, { signal }) =>
      readStakeOptions({ ...options, timeoutMs: stakingTimeoutMs }, venue, signal),
    pools: async (venue, receipts, { signal }) =>
      readStakePools({ ...options, timeoutMs: stakingTimeoutMs }, venue, { receipts, signal }),
    parts: async (venue, held, { signal }) => partsWith(options, venue, { ...held, signal }),
    landed: async (venue, landing, { signal }) =>
      landedWith(options, venue, { ...landing, signal }),
  };
}
