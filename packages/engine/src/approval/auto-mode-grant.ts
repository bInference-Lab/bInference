import { decimalStringSchema, err, type Id, idSchema, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import type { IntentKind } from "../intents/intent-kind.js";
import { epochMsSchema, rowVersionSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** The kinds the auto mode may authorize: trades, and lend or stake moves in own positions. */
export type AutoModeKind = Extract<IntentKind, "swap" | "buy" | "sell" | "lend" | "stake">;

/** Every kind the auto mode may authorize. */
export const autoModeKinds: readonly AutoModeKind[] = ["swap", "buy", "sell", "lend", "stake"];

/**
 * The auto grant: what the signer checks before it signs a step of an intent the auto mode
 * authorized (spec 5, section 5.2, rule 5), as a confirmation record is for a tapped intent. It is
 * the `authorization` of the signer's `authorize` request for such an intent. It holds for one
 * intent and its terms, for transactions that pay at most the network fee cap per gas, while the
 * agent's approval mode keeps the version that authorized the intent, until it expires.
 */
export interface AutoModeGrant {
  readonly approvalMode: "auto";
  readonly agent: Id<"agt">;
  readonly intent: Id<"int">;
  readonly kind: AutoModeKind;
  /** The approval mode's version when the intent passed the auto test. */
  readonly modeVersion: number;
  /** The SHA-256 of the terms the auto test passed: the intent, its request and its quote. */
  readonly termsHash: Sha256Hex;
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

/** An {@link AutoModeGrant} as JSON carries it: ids and hash as text, the cap as a decimal string. */
export interface AutoModeGrantWire extends Pick<
  AutoModeGrant,
  "approvalMode" | "kind" | "modeVersion" | "grantedAtMs" | "expiresAtMs"
> {
  readonly agent: string;
  readonly intent: string;
  readonly termsHash: string;
  readonly networkFeeCapNativeBase: string;
}

/**
 * Decodes an auto grant from JSON, and encodes it back with `z.encode`. A kind the auto mode never
 * authorizes is refused.
 */
export const autoModeGrantSchema: z.ZodType<AutoModeGrant, AutoModeGrantWire> = z.strictObject({
  approvalMode: z.literal("auto"),
  agent: idSchema("agt"),
  intent: idSchema("int"),
  kind: z.enum(["swap", "buy", "sell", "lend", "stake"]),
  modeVersion: rowVersionSchema,
  termsHash: sha256HexSchema,
  grantedAtMs: epochMsSchema,
  expiresAtMs: epochMsSchema,
  networkFeeCapNativeBase: decimalStringSchema,
});

/** What a grant is checked against: the signing request, and the agent's approval mode now. */
export interface AutoModeGrantCheck {
  /** The intent the signing request names. */
  readonly intent: Id<"int">;
  /** The terms hash the signing request carries. */
  readonly termsHash: Sha256Hex;
  /** The agent's approval mode as the store holds it when the request is checked. */
  readonly approvalMode: Pick<ApprovalModeRecord, "agentId" | "mode" | "version">;
  /** The most fee per gas the transaction to sign pays, in base units of the native coin. */
  readonly feePerGasNativeBase: bigint;
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
  if (grant.agent !== approvalMode.agentId) {
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
  if (check.feePerGasNativeBase > grant.networkFeeCapNativeBase) {
    return "over_fee_cap";
  }
  return check.nowMs < grant.expiresAtMs ? undefined : "expired";
}

/**
 * Checks an auto grant against a signing request and the agent's approval mode now, in the order
 * of {@link AutoModeGrantProblem}, and names the first problem. A switch to manual, or any other
 * change of the mode since the grant, fails every grant made before it.
 */
export function checkAutoModeGrant(
  grant: AutoModeGrant,
  check: AutoModeGrantCheck,
): Result<AutoModeGrant, AutoModeGrantProblem> {
  const problem = modeProblem(grant, check) ?? signingProblem(grant, check);
  return problem === undefined ? ok(grant) : err(problem);
}
