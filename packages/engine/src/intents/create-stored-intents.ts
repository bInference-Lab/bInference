import {
  BinferenceError,
  err,
  type Id,
  type IdSource,
  jsonValueSchema,
  ok,
  type Random,
  type Result,
} from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import { ledgerEntryViewOf } from "../ledger/ledger-entry-view.js";
import type { AgentStore, ConfirmationStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { intentPushes } from "../pushes/intent-pushes.js";
import type { StoredConfirmation } from "./confirmation-record.js";
import type { FreezeCommit, FreezeWrite } from "./freeze-write.js";
import { changeOf, type IntentMove } from "./intent-change-of.js";
import type { IntentChange } from "./intent-change.js";
import { draftOf, type NewIntent } from "./intent-draft-of.js";
import { closingOf, type IntentHistory, statusOf } from "./intent-history.js";
import type { IntentRecord } from "./intent-record.js";

/** One intent with everything the engine reads about it, as of one read. */
export interface IntentSnapshot {
  readonly record: IntentRecord;
  readonly history: IntentHistory;
  /** The settings of the intent's agent, read with it. */
  readonly settings: AgentSettings;
  /** The intent as the state machine and the confirmations read it. */
  readonly stored: StoredIntent;
}

/**
 * The engine's one writer of intents (spec 6): it stores new intents and every move the state
 * machine decides, through the intent store, and pushes each write as it lands. It is also the
 * {@link ConfirmationStore} the confirmations write through, so an answer and a step of the money
 * path change an intent the same way.
 */
export interface StoredIntents extends ConfirmationStore {
  /** Stores a new intent with its first event and ledger entry; an id in use is `exists`. */
  create(
    intent: NewIntent,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<IntentSnapshot, "exists">>;
  /** The intent as it stands now, or `undefined` for an unknown id. */
  snapshot(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<IntentSnapshot | undefined>;
  /**
   * Stores one move under the version it read and answers the intent after it. A row that moved
   * on, an unknown intent, or a second confirmation is `stale` and stores nothing.
   */
  move(
    move: IntentMove,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<IntentSnapshot, "stale">>;
  /**
   * Stores a freeze in one write: the agents marked frozen and every intent move with it, each
   * under the version it read, and pushes each write once all landed. A row that moved on, or an
   * unknown one, is `stale` and stores nothing.
   */
  freeze(
    freeze: StoredFreeze,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<FreezeCommit, "stale">>;
}

/**
 * A freeze to store: the agents it marks, whether it marks the whole install, the intent moves it
 * makes and its own ledger entries.
 */
export interface StoredFreeze extends Omit<FreezeWrite, "moves"> {
  readonly moves: readonly IntentMove[];
}

/** What the stored intents read and write through, and where their pushes go. */
export interface StoredIntentsOptions {
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly ids: IdSource;
  /**
   * Where each new card version's callback reference comes from, the random reference its
   * Telegram buttons carry. Without it, card versions carry none and no button can answer them.
   */
  readonly random?: Random;
  readonly publish: PublishPush;
}

function confirmationRecord(confirmation: StoredConfirmation | undefined): Partial<StoredIntent> {
  return confirmation === undefined
    ? {}
    : {
        confirmation: {
          cardVersion: confirmation.cardVersion,
          expiresAtMs: confirmation.expiresAtMs,
        },
      };
}

async function snapshotOf(
  options: StoredIntentsOptions,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<IntentSnapshot | undefined> {
  const { intents, agents } = options;
  const record = await intents.get(intent, { signal });
  if (record === undefined) {
    return undefined;
  }
  const [events, cards, confirmation, settings] = await Promise.all([
    intents.events(intent, { signal }),
    intents.cards(intent, { signal }),
    intents.confirmation(intent, { signal }),
    agents.get(record.agentId, { signal }),
  ]);
  if (settings === undefined) {
    throw new BinferenceError({
      code: "engine.agent_missing",
      message: `The agent of intent ${intent} is not stored.`,
      details: { intent },
    });
  }
  const history = { events, cards };
  const closing = closingOf(history);
  const stored: StoredIntent = {
    intent,
    status: statusOf(record, history),
    version: record.version,
    cards: cardRulesOf(settings.limits),
    ...(closing === undefined ? {} : { closing }),
    ...confirmationRecord(confirmation),
  };
  return { record, history, settings, stored };
}

// The write landed and nothing deletes an intent, so it reads back.
async function written(
  options: StoredIntentsOptions,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const snapshot = await snapshotOf(options, intent, signal);
  if (snapshot === undefined) {
    throw new BinferenceError({
      code: "engine.intent_missing",
      message: `Intent ${intent} did not read back after a write.`,
      details: { intent },
    });
  }
  return snapshot;
}

// A version the row has moved past, or a second confirmation, could only fail in the store.
function isStale(before: IntentSnapshot, move: IntentMove): boolean {
  return (
    before.record.version !== move.version ||
    (move.confirmation !== undefined && before.stored.confirmation !== undefined)
  );
}

// The change the intent store writes for a move, against the intent as read now; `undefined`
// when the row moved past the version the move read.
async function changeFor(
  options: StoredIntentsOptions,
  move: IntentMove,
  signal: AbortSignal,
): Promise<IntentChange | undefined> {
  const before = await snapshotOf(options, move.intent, signal);
  if (before === undefined || isStale(before, move)) {
    return undefined;
  }
  const { record, history } = before;
  const { ids, random } = options;
  return changeOf(move, { record, history, ids, ...(random === undefined ? {} : { random }) });
}

async function moveIntent(
  options: StoredIntentsOptions,
  move: IntentMove,
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, "stale">> {
  const change = await changeFor(options, move, signal);
  if (change === undefined) {
    return err("stale");
  }
  const commit = await options.intents.transition(change, { signal });
  if (!commit.ok) {
    return err("stale");
  }
  intentPushes(commit.value, change).forEach(options.publish);
  return ok(await written(options, move.intent, signal));
}

// Each move becomes its change against the intent as read now; one the row moved past is stale.
async function changesOf(
  options: StoredIntentsOptions,
  moves: readonly IntentMove[],
  signal: AbortSignal,
): Promise<readonly IntentChange[] | undefined> {
  const changes = await Promise.all(moves.map(async (move) => changeFor(options, move, signal)));
  return changes.every((change): change is IntentChange => change !== undefined)
    ? changes
    : undefined;
}

async function freezeIntents(
  options: StoredIntentsOptions,
  freeze: StoredFreeze,
  signal: AbortSignal,
): Promise<Result<FreezeCommit, "stale">> {
  const changes = await changesOf(options, freeze.moves, signal);
  if (changes === undefined) {
    return err("stale");
  }
  const { atMs, agents, isWholeInstall, ledger } = freeze;
  const write = { atMs, agents, isWholeInstall, moves: changes, ledger };
  const commit = await options.intents.freeze(write, { signal });
  if (!commit.ok) {
    return err("stale");
  }
  // The store answers the moves in the order of the changes it was given.
  changes.forEach((change, index) => {
    const moved = commit.value.moves[index];
    if (moved !== undefined) {
      intentPushes(moved, change).forEach(options.publish);
    }
  });
  commit.value.ledgerEntries.forEach((entry) =>
    options.publish({
      topic: "ledger",
      kind: "ledger/appended",
      data: jsonValueSchema.parse(ledgerEntryViewOf(entry)),
    }),
  );
  return commit;
}

/** Creates the {@link StoredIntents} over the intent and agent stores. */
export function createStoredIntents(options: StoredIntentsOptions): StoredIntents {
  return {
    async create(intent, { signal }) {
      const commit = await options.intents.create(draftOf(intent, options.ids), { signal });
      if (!commit.ok) {
        return err("exists");
      }
      intentPushes(commit.value).forEach(options.publish);
      return ok(await written(options, intent.id, signal));
    },
    snapshot: async (intent, { signal }) => snapshotOf(options, intent, signal),
    move: async (move, { signal }) => moveIntent(options, move, signal),
    freeze: async (freeze, { signal }) => freezeIntents(options, freeze, signal),
    read: async (intent, { signal }) => (await snapshotOf(options, intent, signal))?.stored,
    async write(write, { signal }) {
      const moved = await moveIntent(options, write, signal);
      return moved.ok ? ok(moved.value.stored) : moved;
    },
  };
}
