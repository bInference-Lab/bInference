import type { CardCopy } from "../cards/card-copy.js";
import type { CardCopyStore } from "../ports.js";

function sameMessage(left: CardCopy, right: CardCopy): boolean {
  return left.chatId === right.chatId && left.messageId === right.messageId;
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
      return Promise.resolve(copies.filter((copy) => copy.ref === ref));
    },
    ofIntent: async (intent, options) => {
      options.signal.throwIfAborted();
      const ofIt = copies.filter((copy) => copy.intent === intent);
      return Promise.resolve(ofIt.toSorted((left, right) => left.cardVersion - right.cardVersion));
    },
  };
}
