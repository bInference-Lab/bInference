import { BinferenceError, err, type Id, type IdSource, ok, type Result } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import type { AgentStore, ConfirmationStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { intentPushes } from "../pushes/intent-pushes.js";
import type { StoredConfirmation } from "./confirmation-record.js";
import { changeOf, type IntentMove } from "./intent-change-of.js";
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
}

/** What the stored intents read and write through, and where their pushes go. */
export interface StoredIntentsOptions {
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly ids: IdSource;
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

async function moveIntent(
  options: StoredIntentsOptions,
  move: IntentMove,
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, "stale">> {
  const before = await snapshotOf(options, move.intent, signal);
  if (before === undefined || isStale(before, move)) {
    return err("stale");
  }
  const { record, history } = before;
  const change = changeOf(move, { record, history, ids: options.ids });
  const commit = await options.intents.transition(change, { signal });
  if (!commit.ok) {
    return err("stale");
  }
  intentPushes(commit.value, change).forEach(options.publish);
  return ok(await written(options, move.intent, signal));
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
    read: async (intent, { signal }) => (await snapshotOf(options, intent, signal))?.stored,
    async write(write, { signal }) {
      const moved = await moveIntent(options, write, signal);
      return moved.ok ? ok(moved.value.stored) : moved;
    },
  };
}
