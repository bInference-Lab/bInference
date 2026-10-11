import { checkAutoModeGrant } from "@binference/chain";
import type { IntentRecord } from "../intents/intent-record.js";
import type { ExecutionRun } from "./executor-run.js";
import type { SigningTerms } from "./queue-check.js";
import { isRescueAddressInEffect } from "./rescue-queue-check.js";

/** What one more signature of a taken intent is for: a step, a speed-up or a cancel. */
export type SignatureKind = "step" | "speedUp" | "cancel";

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

async function rescueHolds(run: ExecutionRun, record: IntentRecord): Promise<boolean> {
  const { parts, signal } = run;
  return isRescueAddressInEffect(
    record,
    { install: parts.stores.install, clock: parts.clock },
    signal,
  );
}

/**
 * The terms one more signature of a taken intent carries, read again right before it: a later
 * step, a speed-up or a cancel. An auto grant carries the agent's approval mode as it stands now
 * and holds only while that mode keeps the version that authorized the intent. Nothing but a
 * cancel signs once the owner's confirmation expired; the signer decides whether a cancel is still
 * in its grace (decision 0116). A rescue's send signs only while the address its card confirmed
 * is still the rescue address in effect (decision 0110); a cancel moves nothing, so it still may.
 * `undefined` when nothing authorizes the signature now.
 */
export async function termsNow(
  run: ExecutionRun,
  terms: SigningTerms,
  signing: { readonly record: IntentRecord; readonly kind: SignatureKind },
): Promise<SigningTerms | undefined> {
  const { authorization } = terms;
  if (signing.kind === "cancel") {
    return authorization.kind === "confirmation" ? terms : autoTermsNow(run, terms, signing.record);
  }
  if (signing.record.kind === "rescue" && !(await rescueHolds(run, signing.record))) {
    return undefined;
  }
  if (authorization.kind === "confirmation") {
    return run.parts.clock.now() < authorization.expiresAtMs ? terms : undefined;
  }
  return autoTermsNow(run, terms, signing.record);
}
