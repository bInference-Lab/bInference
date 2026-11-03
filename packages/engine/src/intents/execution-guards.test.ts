import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  cancelIntent,
  cancelUnsent,
  failIdentityAtQueue,
  failMovedName,
  failOnchain,
  failUnsent,
  fillOnPaper,
  reconcileFills,
  takeIntoQueue,
} from "./execution-guards.js";
import type { IntentKind } from "./intent-kind.js";
import type { IntentStatus } from "./intent-status.js";
import type { CancelCause, QueueFacts } from "./intent-trigger.js";
import type { GuardInput } from "./transition-guard.js";

const order = "ord_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"ord">;

const cardless: IntentStatus = {
  state: "confirmed",
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  changedAtMs: 0,
  quote: { quotedAtMs: 0, minOutBase: 10n },
};
const confirmed: IntentStatus = {
  ...cardless,
  card: { version: 3, openedAtMs: 0, expiresAtMs: 60_000 },
};

const live: QueueFacts = {
  isAgentLive: true,
  hasPolicyPassed: true,
  confirmation: { cardVersion: 3, expiresAtMs: 50_000 },
};

function queue(facts: QueueFacts, status = confirmed, nowMs = 10_000): GuardInput<"queue_took"> {
  return { status, trigger: { type: "queue_took", ...facts }, nowMs };
}

function cancel(
  cause: Exclude<CancelCause, "step_unsent">,
  kind: IntentKind = "swap",
  hasSignedStep = false,
): GuardInput<"cancel_requested"> {
  return {
    status: { ...confirmed, kind },
    trigger: { type: "cancel_requested", cause, hasSignedStep },
    nowMs: 0,
  };
}

describe("cancelling before signing", () => {
  it("cancels an unsigned intent and records the cause", () => {
    expect(cancelIntent(cancel("request"))).toStrictEqual({
      ok: true,
      value: { cancelCause: "request" },
    });
    expect(cancelIntent(cancel("engine_stopping"))).toStrictEqual({
      ok: true,
      value: { cancelCause: "engine_stopping" },
    });
  });

  it("refuses once a step is signed", () => {
    expect(cancelIntent(cancel("freeze", "swap", true))).toStrictEqual({
      ok: false,
      error: "already_signed",
    });
  });

  it("lets a freeze spare a rescue but not a request", () => {
    expect(cancelIntent(cancel("freeze", "rescue"))).toStrictEqual({
      ok: false,
      error: "rescue_outlasts_freeze",
    });
    expect(cancelIntent(cancel("freeze", "send")).ok).toBe(true);
    expect(cancelIntent(cancel("request", "rescue")).ok).toBe(true);
  });
});

describe("filling on paper", () => {
  it("fills a paper intent and refuses a live one", () => {
    const input: GuardInput<"paper_fill_recorded"> = {
      status: { ...confirmed, isPaper: true },
      trigger: { type: "paper_fill_recorded" },
      nowMs: 0,
    };
    expect(fillOnPaper(input)).toStrictEqual({ ok: true, value: {} });
    expect(fillOnPaper({ ...input, status: confirmed })).toStrictEqual({
      ok: false,
      error: "live_intent",
    });
  });
});

describe("the wallet queue taking an intent", () => {
  it("takes a live intent with an unexpired confirmation of its current card", () => {
    expect(takeIntoQueue(queue(live))).toStrictEqual({ ok: true, value: {} });
  });

  it("never takes a paper intent", () => {
    expect(takeIntoQueue(queue(live, { ...confirmed, isPaper: true }))).toStrictEqual({
      ok: false,
      error: "paper_intent",
    });
  });

  it("refuses while the agent is in paper mode or the policy fails again", () => {
    expect(takeIntoQueue(queue({ ...live, isAgentLive: false }))).toStrictEqual({
      ok: false,
      error: "agent_not_live",
    });
    expect(takeIntoQueue(queue({ ...live, hasPolicyPassed: false }))).toStrictEqual({
      ok: false,
      error: "policy_refused",
    });
  });

  it("takes a rescue while the agent is in paper mode, and nothing else", () => {
    const paperAgent = { ...live, isAgentLive: false };
    expect(takeIntoQueue(queue(paperAgent, { ...confirmed, kind: "rescue" }))).toStrictEqual({
      ok: true,
      value: {},
    });
    expect(takeIntoQueue(queue(paperAgent, { ...confirmed, kind: "send" }))).toStrictEqual({
      ok: false,
      error: "agent_not_live",
    });
  });

  it("refuses a tapped intent without a confirmation of its current card", () => {
    const missing = { ok: false, error: "no_confirmation" };
    expect(takeIntoQueue(queue({ isAgentLive: true, hasPolicyPassed: true }))).toStrictEqual(
      missing,
    );
    const older = { ...live, confirmation: { cardVersion: 2, expiresAtMs: 50_000 } };
    expect(takeIntoQueue(queue(older))).toStrictEqual(missing);
    expect(takeIntoQueue(queue(live, cardless))).toStrictEqual(missing);
  });

  it("refuses a confirmation from the moment it expires", () => {
    expect(takeIntoQueue(queue(live, confirmed, 49_999)).ok).toBe(true);
    expect(takeIntoQueue(queue(live, confirmed, 50_000))).toStrictEqual({
      ok: false,
      error: "expired",
    });
  });

  it("takes an authorized intent only while its authorization holds", () => {
    const filled: IntentStatus = { ...confirmed, proposer: "engine", authorizedBy: { order } };
    const facts: QueueFacts = { isAgentLive: true, hasPolicyPassed: true };
    expect(takeIntoQueue(queue({ ...facts, isAuthorizationValid: true }, filled)).ok).toBe(true);
    const lapsed = { ok: false, error: "authorization_lapsed" };
    expect(takeIntoQueue(queue({ ...facts, isAuthorizationValid: false }, filled))).toStrictEqual(
      lapsed,
    );
    expect(takeIntoQueue(queue({ ...live }, filled))).toStrictEqual(lapsed);
  });
});

function moved(status: IntentStatus): GuardInput<"name_moved"> {
  return { status, trigger: { type: "name_moved" }, nowMs: 0 };
}

describe("a send whose name moved before the queue took it", () => {
  it("ends a live send with name_moved and nothing signed", () => {
    expect(failMovedName(moved({ ...confirmed, kind: "send" }))).toStrictEqual({
      ok: true,
      value: { reason: "name_moved" },
    });
  });

  it("refuses any other kind, and a paper send, which never reaches a queue", () => {
    expect(failMovedName(moved(confirmed))).toStrictEqual({ ok: false, error: "not_send" });
    expect(failMovedName(moved({ ...confirmed, kind: "send", isPaper: true }))).toStrictEqual({
      ok: false,
      error: "paper_intent",
    });
  });
});

describe("a failed step", () => {
  it("fails the intent on chain with the step's reason", () => {
    const input: GuardInput<"step_reverted"> = {
      status: { ...confirmed, state: "executing" },
      trigger: { type: "step_reverted" },
      nowMs: 0,
    };
    expect(failOnchain("reverted")(input)).toStrictEqual({
      ok: true,
      value: { reason: "reverted" },
    });
    expect(failOnchain("stuck_cancelled")(input)).toStrictEqual({
      ok: true,
      value: { reason: "stuck_cancelled" },
    });
    expect(failOnchain("stuck_dropped")(input)).toStrictEqual({
      ok: true,
      value: { reason: "stuck_dropped" },
    });
  });

  it("keeps a rescue executing so the queue retries the step", () => {
    const input: GuardInput<"step_cancelled"> = {
      status: { ...confirmed, state: "executing", kind: "rescue" },
      trigger: { type: "step_cancelled" },
      nowMs: 0,
    };
    expect(failOnchain("stuck_cancelled")(input)).toStrictEqual({
      ok: false,
      error: "rescue_retries",
    });
  });
});

const finalized: IntentStatus = { ...confirmed, state: "finalized", changedAtMs: 1_000 };

function reconcile(
  kind: IntentKind,
  nowMs: number,
  delivery: Readonly<{ isDeliveryRead?: boolean }> = {},
): GuardInput<"fills_reconciled"> {
  return {
    status: { ...finalized, kind },
    trigger: { type: "fills_reconciled", ...delivery },
    nowMs,
  };
}

describe("reconciling", () => {
  it("reconciles any intent but a bridge at once", () => {
    expect(reconcileFills(reconcile("swap", 1_000))).toStrictEqual({ ok: true, value: {} });
  });

  it("reconciles a bridge only once a read found its delivery or refund", () => {
    expect(reconcileFills(reconcile("bridge", 2_000, { isDeliveryRead: true })).ok).toBe(true);
    expect(reconcileFills(reconcile("bridge", 2_000, { isDeliveryRead: false }))).toStrictEqual({
      ok: false,
      error: "delivery_pending",
    });
  });

  it("never reconciles an unread bridge by time, however late it is", () => {
    const weekLater = 1_000 + 7 * 86_400_000;
    expect(reconcileFills(reconcile("bridge", weekLater))).toStrictEqual({
      ok: false,
      error: "delivery_pending",
    });
  });
});

const firstStep = { hasSignedStep: false } as const;
const laterStep = { hasSignedStep: true } as const;

function unsent(
  step: { readonly hasSignedStep: boolean },
  kind: IntentKind = "swap",
): GuardInput<"step_unsent"> {
  return {
    status: { ...confirmed, state: "executing", kind },
    trigger: { type: "step_unsent", hasSignedStep: step.hasSignedStep },
    nowMs: 0,
  };
}

describe("a step that was never signed", () => {
  it("cancels the intent when no step before it was signed", () => {
    expect(cancelUnsent(unsent(firstStep))).toStrictEqual({
      ok: true,
      value: { cancelCause: "step_unsent" },
    });
    expect(cancelUnsent(unsent(laterStep))).toStrictEqual({ ok: false, error: "already_signed" });
  });

  it("fails the intent on chain with step_unsent once an earlier step landed", () => {
    expect(failUnsent(unsent(laterStep))).toStrictEqual({
      ok: true,
      value: { reason: "step_unsent" },
    });
    expect(failUnsent(unsent(firstStep))).toStrictEqual({ ok: false, error: "nothing_signed" });
  });

  it("keeps a rescue executing so the queue retries the step", () => {
    expect(failUnsent(unsent(laterStep, "rescue"))).toStrictEqual({
      ok: false,
      error: "rescue_retries",
    });
  });
});

function refusedIdentity(status: IntentStatus): GuardInput<"identity_refused"> {
  return { status, trigger: { type: "identity_refused", reason: "registry_changed" }, nowMs: 0 };
}

describe("an identity registration the queue read again", () => {
  it("ends a live registration with the registry's reason and nothing signed", () => {
    const status = { ...confirmed, kind: "registerIdentity" } as const;
    expect(failIdentityAtQueue(refusedIdentity(status))).toStrictEqual({
      ok: true,
      value: { reason: "registry_changed" },
    });
  });

  it("refuses any other kind, and a paper registration, which never reaches a queue", () => {
    expect(failIdentityAtQueue(refusedIdentity(confirmed))).toStrictEqual({
      ok: false,
      error: "not_identity",
    });
    const paper = { ...confirmed, kind: "registerIdentity", isPaper: true } as const;
    expect(failIdentityAtQueue(refusedIdentity(paper))).toStrictEqual({
      ok: false,
      error: "paper_intent",
    });
  });
});
