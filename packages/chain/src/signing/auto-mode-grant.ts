import { decimalStringSchema, err, type Id, idSchema, ok, type Result } from "@binference/core";
import { z } from "zod";

/** Every kind the auto mode may authorize: trades, and lend or stake moves in own positions. */
export const autoModeKinds = ["swap", "buy", "sell", "lend", "stake"] as const;

/** A kind the auto mode may authorize. */
export type AutoModeKind = (typeof autoModeKinds)[number];

/**
 * The auto grant: what the signer checks before it signs a step of an intent the auto mode
 * authorized (spec 5, section 5.2, rule 5), as a confirmation record is for a tapped intent. The
 * engine's approval modes make it when the intent passes the auto test (intent-states spec,
 * section 5), and it is the `authorization` of the signer's `authorize` request for such an
 * intent. It holds for one intent and its terms, for transactions that pay at most the network fee
 * cap per gas, while the agent's approval mode keeps the version that authorized the intent, until
 * it expires.
 */
export interface AutoModeGrant {
  readonly approvalMode: "auto";
  readonly agent: Id<"agt">;
  readonly intent: Id<"int">;
  readonly kind: AutoModeKind;
  /** The approval mode's version when the intent passed the auto test. */
  readonly modeVersion: number;
  /** The SHA-256 of the terms the auto test passed, in hex: the intent, its request and its quote. */
  readonly termsHash: string;
  /** When the intent passed the auto test and moved to `confirmed`, in epoch milliseconds. */
  readonly grantedAtMs: number;
  /** After this the grant authorizes no signature: the card lifetime of its kind. */
  readonly expiresAtMs: number;
  /**
   * The chain's network fee cap (decision 0102): the most fee per gas a transaction of the intent
   * may pay without the owner's tap, in base units of the chain's native coin.
   */
  readonly networkFeeCapNativeBase: bigint;
}

/** An {@link AutoModeGrant} as JSON carries it: ids as text, the cap as a decimal string. */
export interface AutoModeGrantWire extends Omit<
  AutoModeGrant,
  "agent" | "intent" | "networkFeeCapNativeBase"
> {
  readonly agent: string;
  readonly intent: string;
  readonly networkFeeCapNativeBase: string;
}

/** The agent's approval mode as the engine read it right before asking for the signature. */
export interface ApprovalModeNow {
  readonly agent: Id<"agt">;
  readonly mode: "manual" | "auto";
  /** The version of the agent's approval-mode record; every change raises it. */
  readonly version: number;
}

/** An {@link ApprovalModeNow} as JSON carries it. */
export interface ApprovalModeNowWire extends Omit<ApprovalModeNow, "agent"> {
  readonly agent: string;
}

const countSchema = z.int().nonnegative();

/**
 * Decodes an {@link AutoModeGrant} from JSON, and encodes it back with `z.encode`. A kind the auto
 * mode never authorizes is refused.
 */
export const autoModeGrantSchema: z.ZodType<AutoModeGrant, AutoModeGrantWire> = z.strictObject({
  approvalMode: z.literal("auto"),
  agent: idSchema("agt"),
  intent: idSchema("int"),
  kind: z.enum(autoModeKinds),
  modeVersion: countSchema,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  grantedAtMs: countSchema,
  expiresAtMs: countSchema,
  networkFeeCapNativeBase: decimalStringSchema,
});

/** Decodes an {@link ApprovalModeNow} from JSON. */
export const approvalModeNowSchema: z.ZodType<ApprovalModeNow, ApprovalModeNowWire> =
  z.strictObject({
    agent: idSchema("agt"),
    mode: z.enum(["manual", "auto"]),
    version: countSchema,
  });

/** What a grant is checked against: the signing request, and the agent's approval mode now. */
export interface AutoModeGrantCheck {
  /** The intent the signing request names. */
  readonly intent: Id<"int">;
  /** The terms hash the signing request carries. */
  readonly termsHash: string;
  readonly approvalMode: ApprovalModeNow;
  /**
   * The most fee per gas the transaction to sign pays, in base units of the native coin. Absent
   * for a transaction whose fee needs no cap, such as a cancel, which moves nothing.
   */
  readonly feePerGasNativeBase?: bigint;
  readonly nowMs: number;
}

/**
 * Why a grant authorizes no signature: it names another intent or another agent, the agent is in
 * manual mode, the mode changed since the grant, the terms changed, the transaction pays more fee
 * per gas than the cap, or the grant expired.
 */
export type AutoModeGrantProblem =
  | "intent_mismatch"
  | "agent_mismatch"
  | "manual"
  | "mode_changed"
  | "terms_mismatch"
  | "over_fee_cap"
  | "expired";

// Whether the grant is this intent's, under the agent's approval mode as it stands.
function modeProblem(
  grant: AutoModeGrant,
  check: AutoModeGrantCheck,
): AutoModeGrantProblem | undefined {
  const { approvalMode } = check;
  if (grant.intent !== check.intent) {
    return "intent_mismatch";
  }
  if (grant.agent !== approvalMode.agent) {
    return "agent_mismatch";
  }
  if (approvalMode.mode !== "auto") {
    return "manual";
  }
  return approvalMode.version === grant.modeVersion ? undefined : "mode_changed";
}

// Whether the transaction is the one the grant was made for, in time.
function signingProblem(
  grant: AutoModeGrant,
  check: AutoModeGrantCheck,
): AutoModeGrantProblem | undefined {
  if (grant.termsHash !== check.termsHash) {
    return "terms_mismatch";
  }
  const fee = check.feePerGasNativeBase;
  if (fee !== undefined && fee > grant.networkFeeCapNativeBase) {
    return "over_fee_cap";
  }
  return check.nowMs < grant.expiresAtMs ? undefined : "expired";
}

/**
 * Checks an auto grant against a signing request and the agent's approval mode now, in the order
 * of {@link AutoModeGrantProblem}, and names the first problem. A switch to manual, or any other
 * change of the mode since the grant, fails every grant made before it. The signer's rule 5 runs
 * this check, and the engine's tests hold the grants it makes to it.
 */
export function checkAutoModeGrant(
  grant: AutoModeGrant,
  check: AutoModeGrantCheck,
): Result<AutoModeGrant, AutoModeGrantProblem> {
  const problem = modeProblem(grant, check) ?? signingProblem(grant, check);
  return problem === undefined ? ok(grant) : err(problem);
}
