import type { Id } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentStore } from "../ports.js";

/** What the card timer reads the waiting cards from, and how it closes one. */
export interface CardTimerParts {
  readonly intents: Pick<IntentStore, "list" | "cards">;
  readonly now: () => number;
  /**
   * Closes the card of an intent whose time is up as expired (spec 6, section 3): the
   * confirmations' timer for an intent's card, and the order's own follow-up for an auto order's
   * card, which moves its order at once.
   */
  readonly expire: (
    intent: Pick<IntentRecord, "id" | "kind">,
    call: { readonly signal: AbortSignal },
  ) => Promise<void>;
}

const pageSize = 500;

// Every intent whose card waits for the owner, least recently changed first, page by page.
async function waitingIntents(
  parts: CardTimerParts,
  signal: AbortSignal,
  after?: IntentRecord,
): Promise<readonly IntentRecord[]> {
  const page = await parts.intents.list(
    {
      states: ["awaiting_confirmation"],
      limit: pageSize,
      ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
    },
    { signal },
  );
  const last = page.at(-1);
  return page.length < pageSize || last === undefined
    ? page
    : [...page, ...(await waitingIntents(parts, signal, last))];
}

// The expiry of the intent's open card: its newest version.
async function openCardExpiry(
  parts: CardTimerParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<number | undefined> {
  const cards = await parts.intents.cards(intent, { signal });
  return cards.at(-1)?.expiresAtMs;
}

/**
 * The card timer (spec 6, section 3): closes as expired every card waiting for the owner whose
 * time is up, one at a time, each through the same write a late tap makes, so its card becomes the
 * `receipt.expired` receipt (spec 4, section 3.5). Answers when the next open card's time is up,
 * or `undefined` when no card waits.
 */
export async function expireDueCards(
  parts: CardTimerParts,
  signal: AbortSignal,
): Promise<number | undefined> {
  const nowMs = parts.now();
  const waiting = await waitingIntents(parts, signal);
  return waiting.reduce<Promise<number | undefined>>(async (earlier, intent) => {
    const next = await earlier;
    const expiresAtMs = await openCardExpiry(parts, intent.id, signal);
    if (expiresAtMs === undefined) {
      return next;
    }
    if (nowMs >= expiresAtMs) {
      await parts.expire(intent, { signal });
      return next;
    }
    return next === undefined ? expiresAtMs : Math.min(next, expiresAtMs);
  }, Promise.resolve(undefined));
}
