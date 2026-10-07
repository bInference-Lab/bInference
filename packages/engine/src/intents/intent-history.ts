import { BinferenceError } from "@binference/core";
import type { CardClosing } from "../confirmations/card-closing.js";
import type { CardRecord } from "./card-record.js";
import { type EventCause, type PaperFill, readEventCause } from "./event-cause.schema.js";
import type { IntentEventRecord } from "./intent-change.js";
import { authorizationDocument, quoteDocument } from "./intent-documents.schema.js";
import type { IntentRecord } from "./intent-record.js";
import type { CardTerms, IntentStatus, QuoteTerms } from "./intent-status.js";

/** An intent's events and card versions as its store keeps them, oldest first. */
export interface IntentHistory {
  readonly events: readonly IntentEventRecord[];
  readonly cards: readonly CardRecord[];
}

function causes(history: IntentHistory): readonly EventCause[] {
  return history.events.map((event) => readEventCause(event.cause));
}

function quoteTermsOf(record: IntentRecord): QuoteTerms | undefined {
  if (record.quote === undefined) {
    return undefined;
  }
  const quote = quoteDocument.decode(record.quote);
  return { quotedAtMs: quote.quotedAt, minOutBase: quote.minOut.base };
}

function cardTermsOf(history: IntentHistory): CardTerms | undefined {
  const card = history.cards.at(-1);
  return card === undefined
    ? undefined
    : { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs };
}

// The parts a step sets once it reaches them; each stays absent until then.
function setParts(record: IntentRecord, history: IntentHistory): Partial<IntentStatus> {
  const quote = quoteTermsOf(record);
  const card = cardTermsOf(history);
  const { reason, authorizedBy } = record;
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(authorizedBy === undefined
      ? {}
      : { authorizedBy: authorizationDocument.decode(authorizedBy) }),
    ...(quote === undefined ? {} : { quote }),
    ...(card === undefined ? {} : { card }),
  };
}

/**
 * The part of a stored intent the state machine reads: the record's columns, who proposed it from
 * its first event, the quote's terms and its newest card version. An intent whose first event
 * names no proposer was not stored by the engine, which is a fault.
 */
export function statusOf(record: IntentRecord, history: IntentHistory): IntentStatus {
  const proposer = causes(history)[0]?.proposer;
  if (proposer === undefined) {
    throw new BinferenceError({
      code: "engine.bad_document",
      message: `Intent ${record.id} has no proposer in its first event.`,
      details: { intent: record.id },
    });
  }
  return {
    state: record.state,
    kind: record.kind,
    proposer,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    changedAtMs: record.changedAtMs,
    ...setParts(record, history),
  };
}

/** How the intent's card last closed, from the newest event that records a closing. */
export function closingOf(history: IntentHistory): CardClosing | undefined {
  return causes(history).findLast((cause) => cause.closing !== undefined)?.closing;
}

/** The paper fill the intent recorded, once it has. */
export function paperFillOf(history: IntentHistory): PaperFill | undefined {
  return causes(history).find((cause) => cause.fill !== undefined)?.fill;
}
