import { err, ok } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import { accountRefParts } from "../caip/account-ref.js";
import type { StakePlanned, StakingVenue } from "../staking/ports.js";
import type { StakePlan } from "../staking/stake-plan.js";
import type {
  PaperStake,
  StakeRequest,
  StakingHolding,
  UnbondingPart,
} from "../staking/staking-terms.js";
import type { TxDraft, TxHash } from "../transaction.js";
import { fakeApprovalData, fakeDraft } from "./fake-draft.js";
import {
  claimedUuid,
  coinOf,
  createPoolBook,
  decodePool,
  type FakeLiquidStakingOptions,
  isReleased,
  partOf,
  type PoolBook,
  pool,
  poolAddress,
  receipt,
  receiptAddress,
  units,
  unitsOf,
} from "./fake-liquid-staking-book.js";
import { amount, coin, fakeChain, sum, wrong } from "./fake-staking-book.js";

/** A fake liquid staking venue whose moves, clock, pause and queue a test controls. */
export interface FakeLiquidStakingVenue extends StakingVenue {
  readonly pool: AccountRef;
  /** Runs drafts the venue built as the chain would, from their sender, and answers their hashes. */
  run(drafts: readonly TxDraft[]): readonly TxHash[];
  /** Moves the venue's clock on by whole seconds. */
  wait(seconds: number): void;
  /** Pauses the venue, so it takes no move. */
  pause(): void;
  /** Lets a paused venue take moves again. */
  unpause(): void;
  /** Holds the queue, so it releases no request whatever its time. */
  holdQueue(): void;
  /** Lets a held queue release its requests again. */
  releaseQueue(): void;
}

type PlanBase = Omit<StakePlan, "action" | "value" | "moved">;

const msPerSecond = 1_000;

function poolOf(book: PoolBook) {
  const total = book.totalUnits();
  return { shares: units(total), coin: amount(coinOf(book, total)) };
}

// The position a plan reads: the paper one when the request gives it, else the wallet's own, its
// parts as the queue reads them now.
function positionOf(book: PoolBook, request: StakeRequest): PaperStake {
  if (request.paper !== undefined) {
    return request.paper;
  }
  const held = book.holding(request.wallet);
  return { shares: held.units, parts: held.requests.map((item) => partOf(book, item)) };
}

function stakePlan(book: PoolBook, base: PlanBase, coinIn: bigint): StakePlanned {
  const minted = unitsOf(book, coinIn);
  if (coinIn < book.options.minStakeBase || minted === 0n) {
    return { ...err("below_min_stake"), facts: { minStake: amount(book.options.minStakeBase) } };
  }
  const value = amount(coinIn);
  const shares = units(minted);
  return ok({
    ...base,
    action: "stake",
    value,
    moved: value,
    shares,
    minShares: shares,
    pool: poolOf(book),
  });
}

function unstakePlan(
  book: PoolBook,
  request: Extract<StakeRequest, { readonly action: "unstake" }>,
  base: PlanBase,
): StakePlanned {
  const held = positionOf(book, request).shares;
  if (held === 0n) {
    return err("nothing_staked");
  }
  const wanted = request.amount === "whole" ? held : request.amount.base;
  if (wanted > held) {
    return err("exceeds_staked");
  }
  const moved = coinOf(book, wanted);
  if (moved < book.options.minUnstakeBase) {
    return { ...err("below_min_stake"), facts: { minStake: amount(book.options.minUnstakeBase) } };
  }
  const readyAtMs = book.nowMs() + book.options.unbondingSeconds * msPerSecond;
  const plan = { ...base, value: amount(0n), moved: amount(moved), shares: units(wanted) };
  return ok({ ...plan, action: "unstake", pool: poolOf(book), readyAtMs });
}

// A claim of the oldest part ready now; with none, when its next part is ready, if one waits.
function claimPlan(book: PoolBook, request: StakeRequest, base: PlanBase): StakePlanned {
  const { parts } = positionOf(book, request);
  const now = book.nowMs();
  const ready = parts.find((part) => part.readyAtMs <= now);
  if (ready === undefined) {
    const next = parts.reduce<UnbondingPart | undefined>(
      (soonest, part) =>
        soonest === undefined || part.readyAtMs < soonest.readyAtMs ? part : soonest,
      undefined,
    );
    return {
      ...err("nothing_to_claim"),
      ...(next === undefined ? {} : { facts: { readyAtMs: next.readyAtMs } }),
    };
  }
  return ok({
    ...base,
    action: "claim",
    value: amount(0n),
    moved: ready.amount,
    parts: [ready.ref],
  });
}

function planOf(book: PoolBook, request: StakeRequest): StakePlanned {
  if (request.validator !== pool) {
    return err("validator_unknown");
  }
  if (book.isPaused()) {
    return err("staking_paused");
  }
  const { name, commissionBps, unbondingSeconds } = book.options;
  const base: PlanBase = {
    wallet: request.wallet,
    validator: pool,
    validatorName: name,
    commissionBps,
    jailed: false,
    paper: request.paper !== undefined,
    unbondingSeconds,
    plannedAtMs: book.nowMs(),
  };
  if (request.action === "stake") {
    return stakePlan(book, base, request.amount.base);
  }
  return request.action === "unstake"
    ? unstakePlan(book, request, base)
    : claimPlan(book, request, base);
}

function draftsOf(plan: StakePlan): readonly TxDraft[] {
  const call = (value: bigint, data: string) =>
    fakeDraft(plan.wallet, { to: poolAddress, value, data });
  if (plan.action === "stake") {
    return [call(plan.value.base, "deposit")];
  }
  if (plan.action === "claim") {
    // A paper claim's part is no request on the chain, so its call, never sent, names request 0.
    const [ref = ""] = plan.parts ?? [];
    return [call(0n, `claimWithdrawByUUID,${plan.paper ? "0" : ref}`)];
  }
  const burned = plan.shares?.base ?? 0n;
  const approval = fakeDraft(plan.wallet, {
    to: receiptAddress,
    value: 0n,
    data: fakeApprovalData(poolAddress, burned),
  });
  return [approval, call(0n, `requestWithdraw,${String(burned)}`)];
}

function runUnstake(book: PoolBook, draft: TxDraft, shares: bigint): TxHash {
  const held = book.holding(draft.from);
  if (held.allowance < shares || held.units < shares) {
    throw wrong("The fake pool pulls only units the wallet holds and approved.");
  }
  const coinOut = coinOf(book, shares);
  const request = { uuid: book.nextUuid(), units: shares, coin: coinOut, startMs: book.nowMs() };
  const left = { units: held.units - shares, allowance: held.allowance - shares };
  book.put(draft.from, { ...left, requests: [...held.requests, request] });
  const part = partOf(book, request);
  const moved = amount(coinOut);
  return book.land({
    action: "unstake",
    validator: pool,
    moved,
    shares: units(shares),
    request: part,
  });
}

function runClaim(book: PoolBook, draft: TxDraft): TxHash {
  const held = book.holding(draft.from);
  const uuid = claimedUuid(draft);
  const taken = held.requests.find((item) => String(item.uuid) === uuid && isReleased(book, item));
  if (taken === undefined) {
    throw wrong("The fake pool claims only a released request.");
  }
  book.put(draft.from, { ...held, requests: held.requests.filter((item) => item !== taken) });
  const claimed = [String(taken.uuid)];
  return book.land({ action: "claim", validator: pool, moved: amount(taken.coin), claimed });
}

// Lands one call as the chain would, and keeps what it did for its read-back; an approval of the
// receipt token lands no move.
function runOne(book: PoolBook, draft: TxDraft): TxHash | undefined {
  if (book.isPaused()) {
    throw wrong("The fake pool is paused.");
  }
  if (draft.payload.startsWith(`${receiptAddress}|`)) {
    const [, , spent = "0"] = draft.payload.split(",");
    book.put(draft.from, { ...book.holding(draft.from), allowance: BigInt(spent) });
    return undefined;
  }
  const call = decodePool(draft);
  if (!call.ok) {
    throw wrong("The fake pool runs only the calls it builds.");
  }
  const { action, value, shares = 0n } = call.value;
  if (action === "unstake") {
    return runUnstake(book, draft, shares);
  }
  if (action === "claim") {
    return runClaim(book, draft);
  }
  const held = book.holding(draft.from);
  const minted = unitsOf(book, value);
  book.put(draft.from, { ...held, units: held.units + minted });
  return book.land({ action, validator: pool, moved: amount(value), shares: units(minted) });
}

function holdingsOf(book: PoolBook, wallet: AccountRef): readonly StakingHolding[] {
  const held = book.holding(wallet);
  if (held.units === 0n && held.requests.length === 0) {
    return [];
  }
  const unbonding = held.requests.map((item) => partOf(book, item));
  const claimable = amount(sum(unbonding.filter((part) => part.readyAtMs <= book.nowMs())));
  const staked = units(held.units);
  const stakedValue = amount(coinOf(book, held.units));
  return [{ wallet, validator: pool, staked, stakedValue, unbonding, claimable }];
}

function checkRequest(request: StakeRequest): void {
  const asset = request.action === "unstake" ? receipt : coin;
  const isAmount =
    request.action === "claim" ||
    request.amount === "whole" ||
    (request.amount.asset === asset && request.amount.base > 0n);
  const accounts = [request.wallet, request.validator];
  if (!isAmount || !accounts.every((item) => accountRefParts(item).chain === fakeChain)) {
    throw wrong("A fake pool stakes the coin, and unstakes its receipt units, on the fake chain.");
  }
}

/**
 * Creates a liquid staking venue for tests on the fake chain: one pool, whose receipt token a
 * stake mints at the rate given; an unstake approves its receipt units to the pool, then queues a
 * request the queue releases `unbondingSeconds` later unless a test holds it; a claim takes the
 * oldest released request by its id. Its decoder reads only the pool's three calls, each
 * crediting its sender; a paper plan reads only the paper position given; each move it ran reads
 * back by its hash.
 */
export function createFakeLiquidStakingVenue(
  options: FakeLiquidStakingOptions,
): FakeLiquidStakingVenue {
  const book = createPoolBook(options);
  return {
    id: "fake-liquid",
    chain: fakeChain,
    pool,
    contracts: [{ chain: fakeChain, names: ["pool"], spenders: ["pool"] }],
    ...readsOf(book),
    plan: async (request, { signal }) => {
      signal.throwIfAborted();
      checkRequest(request);
      return await Promise.resolve(planOf(book, request));
    },
    build: async (plan, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(draftsOf(plan));
    },
    decode: decodePool,
    landed: async (move, { signal }) => {
      signal.throwIfAborted();
      const found = book.landed(move.hash);
      const isOwn = found?.action === move.action && found.validator === move.validator;
      return await Promise.resolve(isOwn ? ok(found) : err("not_found"));
    },
    run: (drafts) => drafts.flatMap((draft) => runOne(book, draft) ?? []),
    wait: book.wait,
    pause: book.pause,
    unpause: book.unpause,
    holdQueue: book.holdQueue,
    releaseQueue: book.releaseQueue,
  };
}

// The pool's reads: its one listing, a wallet's holding, its receipt token and its pool.
function readsOf(book: PoolBook): Pick<StakingVenue, "options" | "holdings" | "receipt" | "pools"> {
  const { name, commissionBps, unbondingSeconds, minStakeBase } = book.options;
  const listed = { validator: pool, name, commissionBps, jailed: false };
  const minStake = amount(minStakeBase);
  return {
    options: async ({ signal }) => {
      signal.throwIfAborted();
      const readAtMs = book.nowMs();
      return await Promise.resolve({ validators: [listed], unbondingSeconds, minStake, readAtMs });
    },
    holdings: async (wallet, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(holdingsOf(book, wallet));
    },
    receipt: async (validator, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(validator === pool ? ok(receipt) : err("validator_unknown"));
    },
    pools: async (receipts, { signal }) => {
      signal.throwIfAborted();
      const isMinted = receipts.includes(receipt) && book.totalUnits() > 0n;
      return await Promise.resolve(isMinted ? [{ validator: pool, pool: poolOf(book) }] : []);
    },
  };
}
