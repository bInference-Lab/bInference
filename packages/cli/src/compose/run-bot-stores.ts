import { err, type Id, ok } from "@binference/core";
import type { CardCopy, CardCopyStore, OwnerBinding, OwnerStore } from "@binference/telegram";

/** The owner's bot's stores for one run of the engine. */
export interface RunBotStores {
  /** Who owns the install: the Telegram user the start code paired. */
  readonly owners: OwnerStore;
  /** Where each card version was posted, so its copies become its receipt. */
  readonly copies: CardCopyStore;
}

// Past this many card versions, the oldest version's copies are forgotten: its receipt then edits
// no message, and its answer still shows on every other surface.
const maxCardVersions = 1_000;

interface Call {
  readonly signal: AbortSignal;
}

function createRunOwners(): OwnerStore {
  const held: { binding?: OwnerBinding } = {};
  return {
    get: async (call: Call) => {
      call.signal.throwIfAborted();
      return Promise.resolve(held.binding);
    },
    bind: async (binding, call) => {
      call.signal.throwIfAborted();
      if (held.binding !== undefined) {
        return Promise.resolve(err("bound"));
      }
      held.binding = binding;
      return Promise.resolve(ok(binding));
    },
  };
}

// The copies of each card version by its reference, in the order kept.
function createRunCopies(): CardCopyStore {
  const byRef = new Map<string, readonly CardCopy[]>();
  const ofIntent = (intent: Id<"int">): readonly CardCopy[] =>
    [...byRef.values()].flat().filter((copy) => copy.intent === intent);
  return {
    keep: async (copy, call) => {
      call.signal.throwIfAborted();
      const kept = byRef.get(copy.ref) ?? [];
      const isKept = kept.some(
        ({ chatId, messageId }) => chatId === copy.chatId && messageId === copy.messageId,
      );
      if (!isKept) {
        if (!byRef.has(copy.ref) && byRef.size >= maxCardVersions) {
          byRef.delete(byRef.keys().next().value ?? copy.ref);
        }
        byRef.set(copy.ref, [...kept, copy]);
      }
      return Promise.resolve();
    },
    find: async (ref, call) => {
      call.signal.throwIfAborted();
      return Promise.resolve(byRef.get(ref) ?? []);
    },
    ofIntent: async (intent, call) => {
      call.signal.throwIfAborted();
      const copies = ofIntent(intent).toSorted(
        (left, right) => left.cardVersion - right.cardVersion,
      );
      return Promise.resolve(copies);
    },
  };
}

/**
 * Creates the bot's stores in memory, for one run of the engine: `engine.sqlite` has no table for
 * the owner binding yet, so the binding and the card copies last until the engine stops.
 */
export function createRunBotStores(): RunBotStores {
  return { owners: createRunOwners(), copies: createRunCopies() };
}
