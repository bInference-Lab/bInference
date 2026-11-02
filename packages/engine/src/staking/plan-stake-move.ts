import type { AssetRef } from "@binference/chain";
import type { PaperStake, StakePlan, StakeRequest, UnbondingPart } from "@binference/chain/staking";
import { err, ok, type Result } from "@binference/core";
import type { Holdings } from "../money-path/wallet-facts.js";
import type { BuildMismatch } from "../venues/build-checks.js";
import { claimMismatch, receiptMismatch } from "../venues/stake-plan-checks.js";
import type { HostPlanned, StakePlanFailure, StakingHost } from "../venues/staking-host.js";
import type { UnbondingStore } from "./ports.js";
import type { ResolvedStake } from "./resolve-stake.js";

/** What a staking move is planned through: the host, and a paper position's holdings and parts. */
export interface StakePlanParts {
  readonly staking: StakingHost;
  /** A paper intent's holding of the venue's receipt token is its paper position's units. */
  readonly holdings: Holdings;
  readonly unbondings: UnbondingStore;
}

type Planned = Pick<ResolvedStake, "venue" | "ask" | "account" | "wallet">;

/** A paper stake's position with the validator, and the receipt token it is kept in. */
interface PaperPosition {
  readonly position: PaperStake;
  readonly receipt: AssetRef;
}

// A paper stake's position with the validator: its receipt units the paper portfolio holds, and
// the parts paper unstakes took out that no paper claim took, soonest ready first.
async function paperStakeOf(
  parts: StakePlanParts,
  planned: Planned,
  signal: AbortSignal,
): Promise<Result<PaperPosition, StakePlanFailure>> {
  const { venue, ask, account, wallet } = planned;
  const receipt = await parts.staking.receipt(venue, ask.validator, { signal });
  if (!receipt.ok) {
    return receipt;
  }
  const holding = { wallet, account, isPaper: true, asset: receipt.value };
  const shares = (await parts.holdings.held(holding, { signal })) ?? 0n;
  const query = { walletId: wallet, isPaper: true, venue: venue.id, validator: ask.validator };
  const open = await parts.unbondings.listOpen(query, { signal });
  const unbonding = open.map(({ requestRef, amount, readyAtMs }) => ({
    ref: requestRef,
    amount,
    readyAtMs,
  }));
  return ok({ position: { shares, parts: unbonding }, receipt: receipt.value });
}

// The parts a claim may take: the paper position's, or the wallet's own as the venue reads them.
async function heldParts(
  parts: StakePlanParts,
  planned: Planned,
  call: { readonly paper?: PaperPosition; readonly signal: AbortSignal },
): Promise<Result<readonly UnbondingPart[], "venue_down">> {
  const { paper, signal } = call;
  if (paper !== undefined) {
    return ok(paper.position.parts);
  }
  const held = { wallet: planned.account, validator: planned.ask.validator };
  return parts.staking.parts(planned.venue, held, { signal });
}

// The engine's own checks of a plan the host passed: a paper plan's shares are the validator's
// receipt token, and a claim takes only parts the wallet holds, ready at the plan's time.
async function ownMismatch(
  parts: StakePlanParts,
  planned: Planned,
  call: { readonly plan: StakePlan; readonly paper?: PaperPosition; readonly signal: AbortSignal },
): Promise<Result<BuildMismatch | undefined, "venue_down">> {
  const { plan, paper } = call;
  const receipt = paper === undefined ? undefined : receiptMismatch(plan, paper.receipt);
  if (receipt !== undefined || plan.action !== "claim") {
    return ok(receipt);
  }
  const held = await heldParts(parts, planned, call);
  return held.ok ? ok(claimMismatch(plan, held.value)) : held;
}

/**
 * Plans a resolved staking move through the venue host at the latest block (decision 0327): a live
 * one reads the wallet itself; a paper one plans against the paper position, its receipt units
 * and the paper unstakes no paper claim took, so it reads nothing of the wallet's own. The engine
 * then holds the plan to what it knows itself: a paper plan's shares to the validator's receipt
 * token (`other_receipt`), and a claim's parts to the wallet's own, ready at the plan's time
 * (`unready_part`), a live one's as the venue reads them. Answers the plan, the venue's refusal
 * with its facts, or the host's.
 */
export async function planStakeMove(
  parts: StakePlanParts,
  planned: Planned,
  call: { readonly isPaper: boolean; readonly signal: AbortSignal },
): Promise<HostPlanned> {
  const { signal } = call;
  const paper = call.isPaper ? await paperStakeOf(parts, planned, signal) : undefined;
  if (paper?.ok === false) {
    return err(paper.error);
  }
  const position = paper === undefined ? {} : { paper: paper.value.position };
  const request: StakeRequest = { ...planned.ask, wallet: planned.account, ...position };
  const plan = await parts.staking.plan(planned.venue, request, { signal });
  if (!plan.ok) {
    return plan;
  }
  const held = paper === undefined ? {} : { paper: paper.value };
  const mismatch = await ownMismatch(parts, planned, { plan: plan.value, ...held, signal });
  if (!mismatch.ok) {
    return mismatch;
  }
  return mismatch.value === undefined
    ? plan
    : { ...err("decode_mismatch"), mismatch: mismatch.value };
}
