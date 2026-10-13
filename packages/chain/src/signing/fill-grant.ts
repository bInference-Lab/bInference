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
   * The most fee per gas the transaction pays, in base units of the native coin; absent for a
   * cancel, whose fee needs no cap of the grant's.
   */
  readonly feePerGasNativeBase?: bigint;
  readonly nowMs: number;
}

/**
 * Why a fill grant authorizes no signature: it names another intent or another order, the order's
 * confirmed terms changed, the order no longer may fill, it recorded a fill since the grant, the
 * request carries other terms, the transaction pays more fee per gas than the cap, it spends what
 * the fill does not or more than its size, or the grant expired.
 */
export type FillGrantProblem =
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

// Whether the order may still fill, and has recorded no fill since the grant.
function orderProblem(grant: FillGrant, check: FillGrantCheck): FillGrantProblem | undefined {
  const { order, nowMs } = check;
  const hasFillLeft = order.maxFills === undefined || order.fills < order.maxFills;
  if (order.state !== "active" || nowMs >= order.expiresAtMs || !hasFillLeft) {
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

/**
 * Checks a fill grant against a signing request and the order as it stands, in the order of
 * {@link FillGrantProblem}, and names the first problem. A grant binds one fill of one order:
 * once the order recorded a fill, ended, paused, expired or used its last fill, every grant made
 * before signs nothing more but a cancel. The signer's rule 5 runs this check, and the engine's
 * tests hold the grants it makes to it.
 */
export function checkFillGrant(
  grant: FillGrant,
  check: FillGrantCheck,
): Result<FillGrant, FillGrantProblem> {
  const bound = bindingProblem(grant, check);
  const problem =
    bound ??
    (check.isCancel
      ? cancelProblem(grant, check)
      : (orderProblem(grant, check) ?? signingProblem(grant, check)));
  return problem === undefined ? ok(grant) : err(problem);
}
