import { decimalStringSchema, err, type Id, idSchema, ok, type Result } from "@binference/core";
import { z } from "zod";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import type { StepAction } from "./sign-step.js";

/**
 * The fill grant: what the signer checks before it signs a step of an auto order's live fill
 * (keys spec, section 5.2, rule 5), as a confirmation record is for a tapped intent. The engine
 * makes it when the fill's check at `simulated` named no breach and the fill moved to
 * `confirmed`. It binds one fill intent and its terms to the order the owner confirmed: that
 * order's terms hash, and the fills the order had recorded then, so no grant outlives the next
 * fill the order records. It holds for transactions that pay at most the network fee cap per gas
 * and spend at most the fill's size of what the fill spends, for a trade card's lifetime.
 */
export interface FillGrant {
  readonly order: Id<"ord">;
  readonly agent: Id<"agt">;
  readonly intent: Id<"int">;
  /** The SHA-256 of the order's card terms the owner confirmed, in hex. */
  readonly orderTermsHash: string;
  /** The fills the order had recorded when the fill was authorized. */
  readonly fillsBefore: number;
  /**
   * The SHA-256 of the fill's own terms, in hex: the intent, its order with the order's terms hash
   * and `fillsBefore`, the request, the quote and the plan.
   */
  readonly termsHash: string;
  /** When the fill moved to `confirmed`, in epoch milliseconds. */
  readonly grantedAtMs: number;
  /** After this the grant authorizes no signature but a cancel's: a trade card's lifetime. */
  readonly expiresAtMs: number;
  /** The most fee per gas a transaction of the fill may pay, in base units of the native coin. */
  readonly networkFeeCapNativeBase: bigint;
  /**
   * What the fill spends and the most of it, in base units: the token's contract, or none for
   * the chain's native coin.
   */
  readonly spend: { readonly token?: AccountRef; readonly maxBase: bigint };
}

/** A {@link FillGrant} as JSON carries it: ids as text, amounts as decimal strings. */
export interface FillGrantWire extends Omit<
  FillGrant,
  "order" | "agent" | "intent" | "networkFeeCapNativeBase" | "spend"
> {
  readonly order: string;
  readonly agent: string;
  readonly intent: string;
  readonly networkFeeCapNativeBase: string;
  readonly spend: { readonly token?: string; readonly maxBase: string };
}

/** The order as the engine read it right before asking for the signature. */
export interface OrderNow {
  readonly id: Id<"ord">;
  /** `active` while it may fill; any other state authorizes nothing but a cancel. */
  readonly state: string;
  /** The SHA-256 of the order's card terms its stored confirmation holds, in hex. */
  readonly termsHash: string;
  readonly expiresAtMs: number;
  /** The fills it recorded so far. */
  readonly fills: number;
  /** The most fills it may make; none when it has no such bound. */
  readonly maxFills?: number;
}

/** An {@link OrderNow} as JSON carries it. */
export interface OrderNowWire extends Omit<OrderNow, "id"> {
  readonly id: string;
}

const countSchema = z.int().nonnegative();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Decodes a {@link FillGrant} from JSON, and encodes it back with `z.encode`. */
export const fillGrantSchema: z.ZodType<FillGrant, FillGrantWire> = z.strictObject({
  order: idSchema("ord"),
  agent: idSchema("agt"),
  intent: idSchema("int"),
  orderTermsHash: hashSchema,
  fillsBefore: countSchema,
  termsHash: hashSchema,
  grantedAtMs: countSchema,
  expiresAtMs: countSchema,
  networkFeeCapNativeBase: decimalStringSchema,
  spend: z.strictObject({
    token: accountRefSchema.exactOptional(),
    maxBase: decimalStringSchema,
  }),
});

/** Decodes an {@link OrderNow} from JSON. */
export const orderNowSchema: z.ZodType<OrderNow, OrderNowWire> = z.strictObject({
  id: idSchema("ord"),
  state: z.string().regex(/^[a-z_]{1,32}$/),
  termsHash: hashSchema,
  expiresAtMs: countSchema,
  fills: countSchema,
  maxFills: countSchema.exactOptional(),
});

/** What a fill grant is checked against: the signing request, the order now and the time. */
export interface FillGrantCheck {
  /** The intent the signing request names. */
  readonly intent: Id<"int">;
  /** The terms hash the signing request carries. */
  readonly termsHash: string;
  readonly order: OrderNow;
  /** What the step does, which the hard rules hold the transaction to. */
  readonly action: StepAction;
  /** Whether the transaction is a cancel at a used nonce, which moves nothing. */
  readonly isCancel: boolean;
  /**
   * The step's place in the fill's plan, from 0; the first step when absent. A later step runs
   * only once the steps before it landed, and finishes its trade while a freeze pauses the order
   * (decision 0211).
   */
  readonly stepIndex?: number;
  /**
   * The most fee per gas the transaction pays, in base units of the native coin; absent for a
   * cancel, whose fee needs no cap of the grant's.
   */
  readonly feePerGasNativeBase?: bigint;
  readonly nowMs: number;
}

/**
 * Why a fill grant authorizes no signature: it was granted later than now or lasts longer than a
 * trade card's 60 seconds, it names another intent or another order, the order's
 * confirmed terms changed, the order no longer may fill, it recorded a fill since the grant, the
 * request carries other terms, the transaction pays more fee per gas than the cap, it spends what
 * the fill does not or more than its size, or the grant expired.
 */
export type FillGrantProblem =
  | "lifetime"
  | "intent_mismatch"
  | "order_mismatch"
  | "order_changed"
  | "order_inactive"
  | "order_filled_since"
  | "terms_mismatch"
  | "over_fee_cap"
  | "over_size"
  | "expired";

/** How long after its grant expired a cancel of the fill still signs: one trade card's lifetime. */
const cancelGraceMs = 60_000;

/** The longest a fill grant lasts, from the fill's confirmation: one trade card's lifetime. */
export const fillGrantLifetimeMs = 60_000;

// A grant from a confirmation not yet made, or one that outlasts a trade card, signs nothing.
function lifetimeProblem(grant: FillGrant, nowMs: number): FillGrantProblem | undefined {
  const isWithin =
    grant.grantedAtMs <= nowMs && grant.expiresAtMs - grant.grantedAtMs <= fillGrantLifetimeMs;
  return isWithin ? undefined : "lifetime";
}

// Whether the grant is this intent's, under the order the owner confirmed.
function bindingProblem(grant: FillGrant, check: FillGrantCheck): FillGrantProblem | undefined {
  const { order } = check;
  if (grant.intent !== check.intent) {
    return "intent_mismatch";
  }
  if (grant.order !== order.id) {
    return "order_mismatch";
  }
  if (grant.orderTermsHash !== order.termsHash) {
    return "order_changed";
  }
  return grant.termsHash === check.termsHash ? undefined : "terms_mismatch";
}

// The states an order lets a step of its fill sign in: active, or paused by a freeze for a later
// step, which finishes a trade whose first step landed (decision 0211).
function signsIn(state: string, stepIndex: number): boolean {
  return state === "active" || (state === "paused" && stepIndex > 0);
}

// Whether the order may still fill, and has recorded no fill since the grant.
function orderProblem(grant: FillGrant, check: FillGrantCheck): FillGrantProblem | undefined {
  const { order, nowMs } = check;
  const hasFillLeft = order.maxFills === undefined || order.fills < order.maxFills;
  if (!signsIn(order.state, check.stepIndex ?? 0) || nowMs >= order.expiresAtMs || !hasFillLeft) {
    return "order_inactive";
  }
  return order.fills === grant.fillsBefore ? undefined : "order_filled_since";
}

// One account on one chain; an EVM address compares without case.
function isSameAccount(left: AccountRef, right: AccountRef): boolean {
  const [one, other] = [accountRefParts(left), accountRefParts(right)];
  return one.chain === other.chain && one.address.toLowerCase() === other.address.toLowerCase();
}

// What the step spends of the fill's asset: the native value of a call, or the amount of an
// approval of the fill's token. `undefined` for a step that spends anything else.
function spentBase(grant: FillGrant, action: StepAction): bigint | undefined {
  const { token } = grant.spend;
  if (action.kind === "call") {
    return token === undefined || action.nativeValue === 0n ? action.nativeValue : undefined;
  }
  const isFillToken =
    action.kind === "approve" && token !== undefined && isSameAccount(action.token, token);
  return isFillToken ? action.amount : undefined;
}

// Whether the transaction is one the grant may sign now: a fee per gas at most the cap, a spend
// within the fill's size, before the grant expired.
function signingProblem(grant: FillGrant, check: FillGrantCheck): FillGrantProblem | undefined {
  const fee = check.feePerGasNativeBase;
  if (fee !== undefined && fee > grant.networkFeeCapNativeBase) {
    return "over_fee_cap";
  }
  const spent = spentBase(grant, check.action);
  if (spent === undefined || spent > grant.spend.maxBase) {
    return "over_size";
  }
  return check.nowMs < grant.expiresAtMs ? undefined : "expired";
}

// A cancel moves nothing: it replaces the fill's transaction at its nonce. It signs for the
// fill's own terms whatever the order became, until a minute after the grant expired.
function cancelProblem(grant: FillGrant, check: FillGrantCheck): FillGrantProblem | undefined {
  return check.nowMs < grant.expiresAtMs + cancelGraceMs ? undefined : "expired";
}

// A reset to 0 of the fill's token approval moves nothing either: it takes back what a trade that
// could not finish left approved (decision 0211).
function isRevoke(grant: FillGrant, action: StepAction): boolean {
  const { token } = grant.spend;
  return (
    action.kind === "approve" &&
    action.amount === 0n &&
    token !== undefined &&
    isSameAccount(action.token, token)
  );
}

/**
 * Checks a fill grant against a signing request and the order as it stands, in the order of
 * {@link FillGrantProblem}, and names the first problem. A grant binds one fill of one order:
 * once the order recorded a fill, ended, expired or used its last fill, every grant made before
 * signs nothing more but a cancel or a reset of its approval to 0, and a pause by a freeze lets
 * only a later step of a trade whose first step landed finish it (decision 0211). The signer's rule 5 runs this check, and the engine's
 * tests hold the grants it makes to it.
 */
export function checkFillGrant(
  grant: FillGrant,
  check: FillGrantCheck,
): Result<FillGrant, FillGrantProblem> {
  const bound = lifetimeProblem(grant, check.nowMs) ?? bindingProblem(grant, check);
  const movesNothing = check.isCancel || isRevoke(grant, check.action);
  const problem =
    bound ??
    (movesNothing
      ? cancelProblem(grant, check)
      : (orderProblem(grant, check) ?? signingProblem(grant, check)));
  return problem === undefined ? ok(grant) : err(problem);
}
