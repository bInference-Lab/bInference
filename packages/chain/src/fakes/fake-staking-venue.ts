import { type Bps, err, ok, type Result } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { StakePlanned, StakingVenue } from "../staking/ports.js";
import type { StakePlan } from "../staking/stake-plan.js";
import type {
  PaperStake,
  StakeRefusal,
  StakeRequest,
  StakingHolding,
  StakingValidator,
} from "../staking/staking-terms.js";
import type { TxDraft, TxHash } from "../transaction.js";
import { fakeDraft } from "./fake-draft.js";
import {
  account,
  amount,
  type Book,
  coin,
  createBook,
  decodeFake,
  type FakeStakingOptions,
  fakeChain,
  hubAddress,
  readyAt,
  readyParts,
  receiptOf,
  sum,
  wrong,
} from "./fake-staking-book.js";

/** A validator of the fake staking venue. */
export interface FakeValidator {
  readonly address: string;
  readonly name: string;
  readonly commissionBps: Bps;
  readonly jailed?: boolean;
  /** Its yearly rate, in basis points; absent when the fake gives none. */
  readonly aprBps?: number;
}

/** A fake staking venue whose moves a test runs and whose clock a test moves. */
export interface FakeStakingVenue extends StakingVenue {
  /** Runs drafts the venue built as the chain would, from their sender, and answers their hashes. */
  run(drafts: readonly TxDraft[]): readonly TxHash[];
  /** Moves the venue's clock on by whole seconds. */
  wait(seconds: number): void;
}

type PlanBase = Omit<StakePlan, "action" | "value" | "moved">;

function listedOf(item: FakeValidator): StakingValidator {
  return {
    validator: account(item.address),
    name: item.name,
    commissionBps: item.commissionBps,
    ...(item.aprBps === undefined ? {} : { aprBps: item.aprBps }),
    jailed: item.jailed === true,
  };
}

// The position a plan reads: the paper one when the request gives it, else the wallet's own.
function positionOf(book: Book, request: StakeRequest): PaperStake {
  return request.paper ?? book.holding(request.wallet, request.validator);
}

function poolOf(book: Book, validator: AccountRef) {
  const shares = book.pool(validator);
  return { shares: amount(shares, receiptOf(validator)), coin: amount(shares) };
}

function unstakePlan(
  book: Book,
  request: Extract<StakeRequest, { readonly action: "unstake" }>,
  base: PlanBase,
): Result<StakePlan, StakeRefusal> {
  const held = positionOf(book, request).shares;
  if (held === 0n) {
    return err("nothing_staked");
  }
  const wanted = request.amount === "whole" ? held : request.amount.base;
  return wanted > held
    ? err("exceeds_staked")
    : ok({
        ...base,
        action: "unstake",
        value: amount(0n),
        moved: amount(wanted),
        shares: amount(wanted, receiptOf(request.validator)),
        pool: poolOf(book, request.validator),
        readyAtMs: readyAt(book),
      });
}

function stakePlan(
  book: Book,
  request: Extract<StakeRequest, { readonly action: "stake" }>,
  base: PlanBase,
): StakePlanned {
  if (request.amount.base < book.options.minStakeBase) {
    return { ...err("below_min_stake"), facts: { minStake: amount(book.options.minStakeBase) } };
  }
  if (base.jailed) {
    return err("validator_jailed");
  }
  const shares = amount(request.amount.base, receiptOf(request.validator));
  const pool = poolOf(book, request.validator);
  return ok({
    ...base,
    action: "stake",
    value: request.amount,
    moved: request.amount,
    shares,
    pool,
  });
}

// A claim of the position's ready parts; with none, when its next part is ready, if one waits.
function claimPlan(book: Book, request: StakeRequest, base: PlanBase): StakePlanned {
  const { parts: held } = positionOf(book, request);
  const ready = readyParts(book, held);
  const next = held[ready.length];
  if (ready.length === 0) {
    return {
      ...err("nothing_to_claim"),
      ...(next === undefined ? {} : { facts: { readyAtMs: next.readyAtMs } }),
    };
  }
  const parts = ready.map((part) => part.ref);
  return ok({ ...base, action: "claim", value: amount(0n), moved: amount(sum(ready)), parts });
}

function planOf(book: Book, request: StakeRequest, found: StakingValidator): StakePlanned {
  const base: PlanBase = {
    wallet: request.wallet,
    validator: request.validator,
    validatorName: found.name,
    commissionBps: found.commissionBps,
    ...(found.aprBps === undefined ? {} : { aprBps: found.aprBps }),
    jailed: found.jailed,
    paper: request.paper !== undefined,
    unbondingSeconds: book.options.unbondingSeconds,
    plannedAtMs: book.nowMs(),
  };
  if (request.action === "stake") {
    return stakePlan(book, request, base);
  }
  return request.action === "unstake"
    ? unstakePlan(book, request, base)
    : claimPlan(book, request, base);
}

// Lands one call as the chain would, and keeps what it did for its read-back.
function runOne(book: Book, draft: TxDraft): TxHash {
  const call = decodeFake(draft);
  if (!call.ok) {
    throw wrong("The fake staking venue runs only the calls it builds.");
  }
  const { action, value, shares = 0n, parts = 0, credits, validator } = call.value;
  const held = book.holding(credits, validator);
  const receipt = (base: bigint) => amount(base, receiptOf(validator));
  if (action === "stake") {
    book.put(credits, validator, { ...held, shares: held.shares + value });
    return book.land({ action, validator, moved: amount(value), shares: receipt(value) });
  }
  if (action === "unstake") {
    const ref = `${accountRefParts(validator).address}:${String(held.next)}`;
    const request = { ref, amount: amount(shares), readyAtMs: readyAt(book) };
    const changed = {
      shares: held.shares - shares,
      parts: [...held.parts, request],
      next: held.next + 1,
    };
    book.put(credits, validator, changed);
    return book.land({
      action,
      validator,
      moved: amount(shares),
      shares: receipt(shares),
      request,
    });
  }
  const taken = readyParts(book, held.parts).slice(0, parts);
  book.put(credits, validator, { ...held, parts: held.parts.slice(taken.length) });
  const claimed = taken.map((part) => part.ref);
  return book.land({ action, validator, moved: amount(sum(taken)), claimed });
}

function holdingsOf(
  book: Book,
  listed: readonly StakingValidator[],
  wallet: AccountRef,
): readonly StakingHolding[] {
  return listed.flatMap((item): StakingHolding[] => {
    const held = book.holding(wallet, item.validator);
    if (held.shares === 0n && held.parts.length === 0) {
      return [];
    }
    const { validator } = item;
    const staked = amount(held.shares, receiptOf(validator));
    const claimable = amount(sum(readyParts(book, held.parts)));
    const unbonding = held.parts;
    return [{ wallet, validator, staked, stakedValue: amount(held.shares), unbonding, claimable }];
  });
}

function draftOf(plan: StakePlan): TxDraft {
  const address = accountRefParts(plan.validator).address;
  const words: Record<StakePlan["action"], string> = {
    stake: `delegate,${address}`,
    unstake: `undelegate,${address},${String(plan.shares?.base ?? 0n)}`,
    claim: `claim,${address},${String(plan.parts?.length ?? 0)}`,
  };
  const call = { to: hubAddress, value: plan.value.base, data: words[plan.action] };
  return fakeDraft(plan.wallet, call);
}

function checkRequest(request: StakeRequest): void {
  const isCoin =
    request.action === "claim" ||
    request.amount === "whole" ||
    (request.amount.asset === coin && request.amount.base > 0n);
  const accounts = [request.wallet, request.validator];
  if (!isCoin || !accounts.every((item) => accountRefParts(item).chain === fakeChain)) {
    throw wrong("A fake stake moves the fake chain's coin between its own accounts.");
  }
}

/**
 * Creates a staking venue for tests on the fake chain: it lists the validators given, one share of
 * a validator is worth one unit of the coin, an unstake's coin is ready `unbondingSeconds` after
 * it, and a claim takes the ready parts, oldest first. Its calls go to one contract and credit
 * their sender; its decoder reads only the three it builds; a paper plan reads only the paper
 * position given; and each move it ran reads back by its hash.
 */
export function createFakeStakingVenue(options: FakeStakingOptions): FakeStakingVenue {
  const listed = options.validators.map(listedOf);
  const book = createBook(options);
  const minStake = amount(options.minStakeBase);
  const { unbondingSeconds } = options;
  return {
    id: "fake-staking",
    chain: fakeChain,
    contracts: [{ chain: fakeChain, names: ["hub"] }],
    options: async ({ signal }) => {
      signal.throwIfAborted();
      const readAtMs = book.nowMs();
      return await Promise.resolve({ validators: listed, unbondingSeconds, minStake, readAtMs });
    },
    holdings: async (wallet, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(holdingsOf(book, listed, wallet));
    },
    receipt: async (validator, { signal }) => {
      signal.throwIfAborted();
      const found = listed.some((item) => item.validator === validator);
      return await Promise.resolve(found ? ok(receiptOf(validator)) : err("validator_unknown"));
    },
    plan: async (request, { signal }) => {
      signal.throwIfAborted();
      checkRequest(request);
      const found = listed.find((item) => item.validator === request.validator);
      const planned: StakePlanned =
        found === undefined ? err("validator_unknown") : planOf(book, request, found);
      return await Promise.resolve(planned);
    },
    build: async (plan, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve([draftOf(plan)]);
    },
    decode: decodeFake,
    landed: async (move, { signal }) => {
      signal.throwIfAborted();
      const found = book.landed(move.hash);
      const isOwn = found?.action === move.action && found.validator === move.validator;
      return await Promise.resolve(isOwn ? ok(found) : err("not_found"));
    },
    run: (drafts) => drafts.map((draft) => runOne(book, draft)),
    wait: book.wait,
  };
}
