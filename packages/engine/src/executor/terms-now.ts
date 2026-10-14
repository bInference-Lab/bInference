import { checkAutoModeGrant } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { LaunchReadFailure } from "../intents/intent-reason.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { ExecutionRun } from "./executor-run.js";
import { fillGrantHolds, orderNowFor } from "./fill-terms.js";
import { launchTargetsOf } from "./launch-targets.js";
import type { SigningTerms } from "./queue-check.js";
import { isRescueAddressInEffect } from "./rescue-queue-check.js";

/**
 * What one more signature of a taken intent is for: a step, a speed-up, a cancel, or the reset to
 * 0 of an approval a fill that could not finish left standing (decision 0211).
 */
export type SignatureKind = "step" | "speedUp" | "cancel" | "revoke";

// An auto grant holds while the agent's mode, read now, keeps the version that authorized the
// intent: a switch to manual fails every grant made before it.
async function autoTermsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  record: IntentRecord,
): Promise<SigningTerms | undefined> {
  const { authorization } = terms;
  if (authorization.kind !== "approvalMode") {
    return terms;
  }
  const { parts, signal } = run;
  const snapshot = await parts.stored.snapshot(record.id, { signal });
  if (snapshot === undefined) {
    return undefined;
  }
  const { agentId, mode, version } = snapshot.settings.approvalMode;
  const current = { agent: agentId, mode, version };
  const { grant } = authorization;
  const check = { intent: record.id, termsHash: grant.termsHash, approvalMode: current };
  const held = checkAutoModeGrant(grant, { ...check, nowMs: parts.clock.now() });
  return held.ok ? { ...terms, authorization: { ...authorization, current } } : undefined;
}

// A fill grant holds while its order, read now, is still active as the owner confirmed it and
// recorded no fill since the grant (decision 0210); a later step also while a freeze pauses it
// (decision 0211).
async function fillTermsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  stepIndex: number,
): Promise<SigningTerms | undefined> {
  const { authorization } = terms;
  if (authorization.kind !== "order") {
    return terms;
  }
  const { parts, signal } = run;
  const current = await orderNowFor(parts, authorization.grant, signal);
  const held =
    current === undefined
      ? undefined
      : fillGrantHolds(authorization.grant, current, { nowMs: parts.clock.now(), stepIndex });
  return held === undefined ? undefined : { ...terms, authorization: held };
}

async function rescueHolds(run: ExecutionRun, record: IntentRecord): Promise<boolean> {
  const { parts, signal } = run;
  return isRescueAddressInEffect(
    record,
    { install: parts.stores.install, clock: parts.clock },
    signal,
  );
}

// A cancel signs under a confirmation or a fill grant whatever became of them, and under an auto
// grant while it holds; a reset of a fill's approval only under its fill grant (decision 0211).
async function undoTermsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  signing: { readonly record: IntentRecord; readonly kind: "cancel" | "revoke" },
): Promise<SigningTerms | undefined> {
  const { kind } = terms.authorization;
  if (signing.kind === "revoke") {
    return kind === "order" ? terms : undefined;
  }
  return kind === "confirmation" || kind === "order"
    ? terms
    : autoTermsNow(run, terms, signing.record);
}

/**
 * The terms one more signature of a taken intent carries, read again right before it: a later
 * step, a speed-up or a cancel. An auto grant carries the agent's approval mode as it stands now
 * and holds only while that mode keeps the version that authorized the intent. An order fill's
 * grant carries its order as it stands now and holds only while the order is active as the owner
 * confirmed it, with no fill recorded since (decision 0210), and a later step also while a freeze
 * pauses it; a fill's approval left standing resets to 0 under its grant (decision 0211). Nothing
 * but a cancel signs once the
 * owner's confirmation or the fill's grant expired; the signer decides whether a cancel is still
 * in its grace (decision 0116). A rescue's send signs only while the address its card confirmed
 * is still the rescue address in effect (decision 0110); a cancel moves nothing, so it still may.
 * `undefined` when nothing authorizes the signature now.
 */
export async function termsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  signing: {
    readonly record: IntentRecord;
    readonly kind: SignatureKind;
    /** The step's place in its plan; the first step when absent. */
    readonly index?: number;
  },
): Promise<SigningTerms | undefined> {
  const { authorization } = terms;
  if (signing.kind === "cancel" || signing.kind === "revoke") {
    return undoTermsNow(run, terms, { record: signing.record, kind: signing.kind });
  }
  if (signing.record.kind === "rescue" && !(await rescueHolds(run, signing.record))) {
    return undefined;
  }
  if (authorization.kind === "confirmation") {
    return run.parts.clock.now() < authorization.expiresAtMs ? terms : undefined;
  }
  return authorization.kind === "order"
    ? fillTermsNow(run, terms, signing.index ?? 0)
    : autoTermsNow(run, terms, signing.record);
}

/**
 * The terms of a launch wallet's curve trade with its launch's contracts read again, right before
 * a later step or a speed-up signs (decision 0218): the signer then checks the contracts the
 * launchpad names now. Terms that name no launch contract come back as they are. A read that
 * fails is `launch_unread`, and a launchpad that no longer holds the token on the curve, or names
 * no contract of its launch any more, `launch_moved`; nothing signs then.
 */
export async function launchTermsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  record: IntentRecord,
): Promise<Result<SigningTerms, LaunchReadFailure>> {
  if (terms.allowed.launch === undefined) {
    return ok(terms);
  }
  const read = await launchTargetsOf(record, run.parts, run.signal);
  if (read.kind === "failed") {
    return err(read.reason);
  }
  return read.kind === "read"
    ? ok({ ...terms, allowed: { ...terms.allowed, launch: read.launch } })
    : err("launch_moved");
}
