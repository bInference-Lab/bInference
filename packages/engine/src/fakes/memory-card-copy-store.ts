import type { CardCopy } from "../surfaces/card-copy.js";
import type { CardCopyStore } from "../surfaces/ports.js";

function sameMessage(left: CardCopy, right: CardCopy): boolean {
  return left.chatId === right.chatId && left.messageId === right.messageId;
}

// The order the store reads copies in: by when they were sent, then by message id as its text
// column sorts.
function bySending(left: CardCopy, right: CardCopy): number {
  const [a, b] = [String(left.messageId), String(right.messageId)];
  if (left.sentAtMs !== right.sentAtMs || a === b) {
    return left.sentAtMs - right.sentAtMs;
  }
  return a < b ? -1 : 1;
}

/** Creates an empty in-memory {@link CardCopyStore}, for tests. */
export function createMemoryCardCopyStore(): CardCopyStore {
  const copies: CardCopy[] = [];
  return {
    keep: async (copy, options) => {
      options.signal.throwIfAborted();
      if (!copies.some((kept) => kept.ref === copy.ref && sameMessage(kept, copy))) {
        copies.push({ ...copy });
      }
      return Promise.resolve();
    },
    find: async (ref, options) => {
      options.signal.throwIfAborted();
      return Promise.resolve(copies.filter((copy) => copy.ref === ref).toSorted(bySending));
    },
    ofIntent: async (intent, options) => {
      options.signal.throwIfAborted();
      const ofIt = copies.filter((copy) => copy.intent === intent);
      return Promise.resolve(
        ofIt.toSorted(
          (left, right) => left.cardVersion - right.cardVersion || bySending(left, right),
        ),
      );
    },
  };
}
