import type { Id } from "@binference/core";
import type { CardOpening } from "../intents/card-record.js";
import type { ConfirmationDraft } from "../intents/confirmation-record.js";
import type { IntentChange } from "../intents/intent-change.js";
import type { IntentDraft } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import type { IntentStore, LedgerStore } from "../ports.js";
import { fixtureHash, fixtureId } from "./store-fixtures.js";

/**
 * An intent store under test, the ledger it appends intent entries to, and an agent and wallet
 * that exist in its database, for the rows that name them.
 */
export interface IntentStoreSubject {
  readonly store: IntentStore;
  readonly ledger: LedgerStore;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
}

/** A ledger draft about intent `n`. */
export function intentLedger(n: number, step: number, kind: string): LedgerDraft {
  return {
    id: fixtureId("led", n * 100 + step),
    atMs: 1_000 * n + step,
    kind,
    subject: fixtureId("int", n),
    data: { step },
  };
}

/** A new swap intent `n` of the subject's agent, proposed at `1000 * n`. */
export function intentDraft(subject: IntentStoreSubject, n: number): IntentDraft {
  return {
    id: fixtureId("int", n),
    agentId: subject.agentId,
    walletId: subject.walletId,
    kind: "swap",
    state: "proposed",
    request: { kind: "swap", sell: { asset: "fake:1/slip44:1", base: "1500000000000000000" } },
    hasOutsideContent: false,
    isPaper: true,
    proposer: fixtureId("tok", 1),
    atMs: 1_000 * n,
    cause: { trigger: "propose" },
    ledger: { ...intentLedger(n, 0, "proposed"), agentId: subject.agentId },
  };
}

/** A move of intent `n` from `version` into `state`, at `1000 * n + version + 1`. */
export function intentMove(n: number, version: number, state: IntentState): IntentChange {
  return {
    id: fixtureId("int", n),
    expectedVersion: version,
    state,
    atMs: 1_000 * n + version + 1,
    cause: { trigger: state },
  };
}

/** Card version `version` of intent `n`, open for a minute. */
export function cardOf(n: number, version: number): CardOpening {
  return {
    id: fixtureId("crd", n * 10 + version),
    version,
    termsHash: fixtureHash(`terms ${String(n)} ${String(version)}`),
    callbackRef: `ref${String(n)}v${String(version)}`.padEnd(16, "x"),
    openedAtMs: 1_000 * n,
    expiresAtMs: 1_000 * n + 60_000,
  };
}

/** The owner's yes to card version `version` of intent `n`, on Telegram. */
export function confirmationOf(n: number, version: number): ConfirmationDraft {
  const card = cardOf(n, version);
  return {
    id: fixtureId("cnf", n * 10 + version),
    cardId: card.id,
    cardVersion: version,
    termsHash: card.termsHash,
    bySurface: "telegram",
    byRef: "7012345678",
    expiresAtMs: card.expiresAtMs,
  };
}
