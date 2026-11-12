import type { AssetRef, SignerLock } from "@binference/chain";
import type { Id } from "@binference/core";
import type { Address, Hex } from "viem";
import type {
  ServiceOutcome,
  ServiceRefusalReason,
  SignerServiceRequest,
} from "../signing/signer-service-wire.schema.js";
import type { SumsAsk } from "./fake-signer-sums.js";

/** What a step of a plan does, as the sums and the breaker read it. */
export type FakeStepDoes =
  | { readonly kind: "call" }
  | { readonly kind: "approve"; readonly token: AssetRef; readonly amountBase: bigint }
  | { readonly kind: "send"; readonly recipient: string };

/** One step of an intent's stored plan: the call it makes and what that call does. */
export interface FakeServiceStep {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly does: FakeStepDoes;
  /** A hard rule of spec 5, section 5.2 the step breaks, which the service refuses it under. */
  readonly breaks?: `rule_${1 | 2 | 3 | 4 | 5 | 6}`;
}

/** What approved an intent, as the install's rows hold it. */
export type FakeAuthorization = { readonly expiresAtMs: number } & (
  | { readonly kind: "confirmation"; readonly id: Id<"cnf"> }
  | { readonly kind: "fill"; readonly source: Id<"ord"> | Id<"whr"> }
  | { readonly kind: "approvalMode" }
);

/** An intent as the install's rows hold it. */
export interface FakeServiceIntent {
  readonly id: Id<"int">;
  /** The wallet that signs its steps, which the service holds. */
  readonly wallet: Address;
  /** Only an `executing` intent signs. */
  readonly state: "confirmed" | "executing" | "ended";
  /** A rescue, the one intent the pulled breaker still signs for. */
  readonly isRescue?: boolean;
  readonly authorization: FakeAuthorization;
  readonly steps: readonly FakeServiceStep[];
}

/** The lease of the install, as its rows hold it. */
export interface FakeLease {
  readonly worker: string;
  readonly fence: number;
  readonly expiresAtMs: number;
}

/** The service's state the checks before the sums read. */
export interface FakeServiceFacts {
  readonly install: Id<"ins">;
  readonly lease: FakeLease | undefined;
  readonly isBreakerPulled: boolean;
  readonly keyLock: Exclude<SignerLock, "breaker"> | undefined;
  /** The rescue address in effect, lowercase. */
  readonly rescue: string | undefined;
  readonly nowMs: number;
}

const cancelGraceMs = 60_000;

/** A refusal with its reason. */
export function refusedFor(reason: ServiceRefusalReason): ServiceOutcome {
  return { outcome: "refused", reason };
}

// A rescue's step that pays the rescue address in effect, or a speed-up or cancel of one.
function isRescueStep(
  facts: FakeServiceFacts,
  intent: FakeServiceIntent | undefined,
  step: number,
): boolean {
  const does = intent?.steps[step]?.does;
  return (
    intent?.isRescue === true &&
    does?.kind === "send" &&
    facts.rescue !== undefined &&
    does.recipient.toLowerCase() === facts.rescue
  );
}

/**
 * What a locked service answers before anything else (spec 5, sections 8.1 and 8.6): a key whose
 * read-back failed signs nothing, and a pulled breaker signs only a rescue to the rescue address.
 */
export function lockedOutcome(
  facts: FakeServiceFacts,
  request: SignerServiceRequest,
  intent: FakeServiceIntent | undefined,
): ServiceOutcome | undefined {
  if (facts.keyLock !== undefined) {
    return { outcome: "locked", reason: facts.keyLock };
  }
  const isPassed = !facts.isBreakerPulled || isRescueStep(facts, intent, request.step);
  return isPassed ? undefined : { outcome: "locked", reason: "breaker" };
}

/** Whether the worker holds the install's lease under the request's fence, by the clock now. */
export function holdsLease(
  facts: FakeServiceFacts,
  request: SignerServiceRequest,
  worker: string,
): boolean {
  const { lease } = facts;
  return (
    lease !== undefined &&
    request.install === facts.install &&
    lease.worker === worker &&
    lease.fence === request.fence &&
    lease.expiresAtMs > facts.nowMs
  );
}

function namesIt(authorization: FakeAuthorization, request: SignerServiceRequest): boolean {
  const asked = request.authorization;
  if (authorization.kind === "confirmation") {
    return asked.kind === "confirmation" && asked.id === authorization.id;
  }
  if (authorization.kind === "fill") {
    return asked.kind === "fill" && asked.source === authorization.source;
  }
  return asked.kind === "approvalMode";
}

/**
 * Why the intent's own authorization does not let this request sign now, from the install's rows:
 * one the request does not name, or one that ended, a minute later for a cancel of a confirmed
 * intent or a fill (decision 0116). Undefined when it holds.
 */
export function authorizationRefusal(
  intent: FakeServiceIntent,
  request: SignerServiceRequest,
  nowMs: number,
): ServiceRefusalReason | undefined {
  const { authorization } = intent;
  if (!namesIt(authorization, request)) {
    return "no_authorization";
  }
  const isGraced = request.replaces === "cancel" && authorization.kind !== "approvalMode";
  const endMs = authorization.expiresAtMs + (isGraced ? cancelGraceMs : 0);
  return nowMs < endMs ? undefined : "authorization_ended";
}

/** The call a request's transaction makes: the plan step's, or a cancel's to the wallet itself. */
export function callOf(
  intent: FakeServiceIntent,
  step: FakeServiceStep,
  request: SignerServiceRequest,
): { readonly to: Address; readonly value: bigint; readonly data: Hex } {
  return request.replaces === "cancel"
    ? { to: intent.wallet, value: 0n, data: "0x" }
    : { to: step.to, value: step.value, data: step.data };
}

/** What the transaction adds to the sums (decision 0426): a cancel adds nothing. */
export function askOf(
  step: FakeServiceStep,
  request: SignerServiceRequest,
  isCapped: (token: AssetRef) => boolean,
): SumsAsk {
  if (request.replaces === "cancel") {
    return { nativeBase: 0n, nativeRefusable: false };
  }
  const { does } = step;
  const approval =
    does.kind === "approve" && isCapped(does.token)
      ? { token: does.token, amountBase: does.amountBase }
      : undefined;
  return {
    nativeBase: step.value,
    nativeRefusable: does.kind === "call",
    ...(approval === undefined ? {} : { approval }),
  };
}
