import {
  BinferenceError,
  type IdSource,
  type JsonValue,
  type Random,
  stableJson,
} from "@binference/core";
import type { IntentWrite } from "../confirmations/stored-intent.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import { sha256Hex } from "../records/sha256-hex.js";
import type { CardOpening, CardRecord, CardVersionClosing } from "./card-record.js";
import type { ConfirmationDraft } from "./confirmation-record.js";
import { closingDocument, type PaperFill, paperFillDocument } from "./event-cause.schema.js";
import type { IntentChange } from "./intent-change.js";
import {
  authorizationDocument,
  planDocument,
  quoteDocument,
  simulationDocument,
} from "./intent-documents.schema.js";
import type { IntentHistory } from "./intent-history.js";
import type { IntentFields, IntentRecord } from "./intent-record.js";
import type { CardTerms } from "./intent-status.js";

/**
 * One move to store: the step the state machine decided under the version it read, with what the
 * step produced. A status with a newer card version opens that version and replaces the open one.
 */
export interface IntentMove extends IntentWrite {
  /** The documents the step produced, such as the quote and the plan at `quoted`. */
  readonly fields?: IntentFields;
  /** Who caused a move no card answer names: the token or device that called, or `engine`. */
  readonly by?: string;
  /** The fill a paper intent records as it moves to `paper_filled`. */
  readonly fill?: PaperFill;
}

/** What a move is stored against: the intent as read, and where new ids come from. */
export interface MoveContext {
  readonly record: IntentRecord;
  readonly history: IntentHistory;
  readonly ids: IdSource;
  /** Where a new card version's callback reference comes from; without it, it has none. */
  readonly random?: Random;
}

interface JsonObject {
  readonly [key: string]: JsonValue;
}

function causeOf(move: IntentMove): JsonObject {
  const { event } = move.step;
  const { by, closing, fill } = move;
  return {
    trigger: event.trigger,
    ...(by === undefined ? {} : { by }),
    ...(closing === undefined ? {} : { closing: closingDocument.encode(closing) }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.cancelCause === undefined ? {} : { cancelCause: event.cancelCause }),
    ...(fill === undefined ? {} : { fill: paperFillDocument.encode(fill) }),
  };
}

// A re-quote replaces the quote, the plan and the simulation together.
function fieldsOf(move: IntentMove): IntentFields {
  const { requote, fields } = move;
  const { reason, authorizedBy } = move.step.status;
  return {
    ...(requote === undefined
      ? {}
      : {
          quote: quoteDocument.encode(requote.quote),
          plan: planDocument.encode(requote.steps),
          simulation: simulationDocument.encode(requote.simulation),
        }),
    ...fields,
    ...(reason === undefined ? {} : { reason }),
    ...(authorizedBy === undefined
      ? {}
      : { authorizedBy: authorizationDocument.encode(authorizedBy) }),
  };
}

interface CardWrites {
  readonly openCard?: CardOpening;
  readonly closeCard?: CardVersionClosing;
}

// Spec 4, section 2: 12 random bytes, which base64url writes in 16 characters.
const callbackRefBytes = 12;

// The terms hash covers what the card shows: the request and the quote of this version.
function opening(card: CardTerms, context: MoveContext, quote: JsonValue | undefined): CardOpening {
  const { record, ids, random } = context;
  const { version } = card;
  const terms = { intent: record.id, version, request: record.request, quote: quote ?? null };
  return {
    id: ids.next("crd"),
    version,
    termsHash: sha256Hex(stableJson(terms)),
    ...(random === undefined
      ? {}
      : { callbackRef: Buffer.from(random.bytes(callbackRefBytes)).toString("base64url") }),
    openedAtMs: card.openedAtMs,
    expiresAtMs: card.expiresAtMs,
  };
}

function closingReason(move: IntentMove): CardVersionClosing["reason"] | undefined {
  if (move.closing !== undefined) {
    return move.closing.outcome;
  }
  return move.step.status.state === "cancelled" ? "cancelled" : undefined;
}

function cardWrites(move: IntentMove, context: MoveContext, quote?: JsonValue): CardWrites {
  const { cards } = context.history;
  const open = cards.find((card) => card.closedAtMs === undefined);
  const { card } = move.step.status;
  if (card !== undefined && card.version > (cards.at(-1)?.version ?? 0)) {
    const openCard = opening(card, context, quote);
    return open === undefined
      ? { openCard }
      : { openCard, closeCard: { id: open.id, reason: "replaced" } };
  }
  const reason = closingReason(move);
  return open === undefined || reason === undefined ? {} : { closeCard: { id: open.id, reason } };
}

function confirmationOf(
  move: IntentMove,
  cards: readonly CardRecord[],
  ids: IdSource,
): ConfirmationDraft | undefined {
  const { confirmation, closing } = move;
  if (confirmation === undefined) {
    return undefined;
  }
  const card = cards.find((stored) => stored.version === confirmation.cardVersion);
  if (card === undefined || closing?.outcome !== "confirmed") {
    throw new BinferenceError({
      code: "engine.bad_confirmation",
      message: "A confirmation names a stored card version and the Confirm that closed it.",
      details: { intent: move.intent },
    });
  }
  return {
    id: ids.next("cnf"),
    cardId: card.id,
    cardVersion: card.version,
    termsHash: card.termsHash,
    bySurface: closing.answeredBy.surface,
    byRef: closing.answeredBy.by,
    expiresAtMs: confirmation.expiresAtMs,
  };
}

function ledgerOf(move: IntentMove, context: MoveContext, cause: JsonObject): LedgerDraft {
  const { event } = move.step;
  const { record, ids } = context;
  return {
    id: ids.next("led"),
    atMs: event.atMs,
    agentId: record.agentId,
    kind: event.to,
    subject: record.id,
    data: { ...cause, from: event.from, to: event.to },
  };
}

/**
 * Turns a move into the change the intent store writes all or nothing: the state, the documents
 * the step produced, the event with its cause, the card version it opens or closes, the
 * confirmation and, when the target state has one, the ledger entry (spec 6, section 8).
 */
export function changeOf(move: IntentMove, context: MoveContext): IntentChange {
  const { step } = move;
  const fields = fieldsOf(move);
  const cause = causeOf(move);
  const cards = cardWrites(move, context, fields.quote ?? context.record.quote);
  const known =
    cards.openCard === undefined
      ? context.history.cards
      : [...context.history.cards, { ...cards.openCard, intentId: context.record.id }];
  const confirmation = confirmationOf(move, known, context.ids);
  return {
    id: move.intent,
    expectedVersion: move.version,
    state: step.status.state,
    atMs: step.event.atMs,
    cause,
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
    ...(step.event.hasLedgerEntry ? { ledger: ledgerOf(move, context, cause) } : {}),
    ...cards,
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}
