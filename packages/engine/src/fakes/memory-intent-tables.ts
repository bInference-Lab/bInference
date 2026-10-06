import { BinferenceError, type Id } from "@binference/core";
import type { CardRecord } from "../intents/card-record.js";
import type { StoredConfirmation } from "../intents/confirmation-record.js";
import type { IntentChange, IntentEventRecord } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { constraintFault } from "./memory-call.js";

/**
 * The rows of an in-memory intent store behind functions: reads return copies, and writes change
 * nothing until `checkCardWrites` has passed for the move.
 */
export interface MemoryIntentTables {
  readonly intent: (id: Id<"int">) => IntentRecord | undefined;
  readonly intents: () => readonly IntentRecord[];
  readonly events: (id: Id<"int">) => readonly IntentEventRecord[];
  readonly cards: (id: Id<"int">) => readonly CardRecord[];
  readonly confirmation: (id: Id<"int">) => StoredConfirmation | undefined;
  /** Throws, before anything is written, when a move's card or confirmation write would fail. */
  readonly checkCardWrites: (change: IntentChange) => void;
  readonly saveIntent: (intent: IntentRecord) => void;
  readonly saveCardWrites: (change: IntentChange) => void;
  readonly addEvent: (event: Omit<IntentEventRecord, "id">) => IntentEventRecord;
}

function checkOpenCard(cards: readonly CardRecord[], change: IntentChange): void {
  const card = change.openCard;
  const taken = cards.some(
    (stored) =>
      stored.id === card?.id || (stored.intentId === change.id && stored.version === card?.version),
  );
  if (card !== undefined && taken) {
    throw constraintFault(`card ${card.id} or version ${String(card.version)} is taken`);
  }
}

function checkCloseCard(cards: readonly CardRecord[], change: IntentChange): void {
  const closing = change.closeCard;
  const isOpen = cards.some(
    (card) =>
      card.id === closing?.id && card.intentId === change.id && card.closedAtMs === undefined,
  );
  if (closing !== undefined && !isOpen) {
    throw new BinferenceError({
      code: "store.card_not_open",
      message: `Card ${closing.id} is not an open card of intent ${change.id}.`,
      details: { intent: change.id, card: closing.id },
    });
  }
}

function checkConfirmation(
  cards: readonly CardRecord[],
  confirmations: ReadonlyMap<Id<"int">, StoredConfirmation>,
  change: IntentChange,
): void {
  const { confirmation, openCard } = change;
  const known = [...cards, ...(openCard === undefined ? [] : [openCard])].some(
    (card) => card.id === confirmation?.cardId && card.version === confirmation.cardVersion,
  );
  if (confirmation !== undefined && (confirmations.has(change.id) || !known)) {
    throw constraintFault(`intent ${change.id} has a confirmation, or no such card version`);
  }
}

function closed(card: CardRecord, change: IntentChange): CardRecord {
  const reason = change.closeCard?.id === card.id ? change.closeCard.reason : undefined;
  return reason === undefined ? card : { ...card, closedAtMs: change.atMs, closeReason: reason };
}

/** Creates the empty rows of one in-memory intent store. */
export function createMemoryIntentTables(): MemoryIntentTables {
  const intents = new Map<Id<"int">, IntentRecord>();
  const events: IntentEventRecord[] = [];
  let cards: readonly CardRecord[] = [];
  const confirmations = new Map<Id<"int">, StoredConfirmation>();
  return {
    intent: (id) => structuredClone(intents.get(id)),
    intents: () => structuredClone([...intents.values()]),
    events: (id) => structuredClone(events.filter((event) => event.intentId === id)),
    cards: (id) => structuredClone(cards.filter((card) => card.intentId === id)),
    confirmation: (id) => structuredClone(confirmations.get(id)),
    checkCardWrites(change) {
      checkCloseCard(cards, change);
      checkOpenCard(cards, change);
      checkConfirmation(cards, confirmations, change);
    },
    saveIntent: (intent) => intents.set(intent.id, structuredClone(intent)),
    saveCardWrites(change) {
      const { openCard, confirmation } = structuredClone(change);
      const opened = openCard === undefined ? [] : [{ ...openCard, intentId: change.id }];
      cards = [...cards.map((card) => closed(card, change)), ...opened];
      if (confirmation !== undefined) {
        confirmations.set(change.id, { ...confirmation, intentId: change.id, atMs: change.atMs });
      }
    },
    addEvent(event) {
      const stored = { ...structuredClone(event), id: events.length + 1 };
      events.push(stored);
      return structuredClone(stored);
    },
  };
}
