import type { AnswerCard, AnsweredCard } from "../operations/answer-card.js";
import type { IntentStore } from "../ports.js";
import type { CardPress, CardStanding } from "./card-press.js";
import type { CardShowings } from "./create-card-showings.js";
import { type OwnerIdOf, pressedByOwner } from "./pressed-by-owner.js";

/**
 * The engine's side of the owner's presses of Telegram card buttons: it finds the card version by
 * its callback reference, checks that the presser is the owner, and stores the answer through the
 * confirmations before it resolves. The first answer to a card wins (spec 4, section 2).
 */
export interface CardPresses {
  /**
   * Answers a card for a press and says how the card stands. Rejects with the signal's reason
   * once it aborts, and answers nothing.
   */
  answer(press: CardPress, options: { readonly signal: AbortSignal }): Promise<CardStanding>;
}

/** What {@link createCardPresses} reads and answers through. */
export interface CardPressesOptions {
  /** Finds the card version a press names by its callback reference. */
  readonly intents: Pick<IntentStore, "cardByRef">;
  /** The engine's answer step: it stores the answer, then fills or queues a confirmed intent. */
  readonly answer: AnswerCard;
  /** The owner's numeric Telegram id, or `undefined` before the owner pairs. */
  readonly ownerId: OwnerIdOf;
  /** What followed the card's closing, which the pressed copy's receipt shows. */
  readonly showings: Pick<CardShowings, "settled">;
}

const unknown: CardStanding = { status: "unknown" };

// A card that closed without a closing, as a cancel closes it, has no receipt to show. A paper
// intent filled at once when confirmed, and an unfreeze or an auto order's card took effect, so
// its receipt shows what followed.
async function standingOf(
  options: CardPressesOptions,
  { outcome, intent }: AnsweredCard,
  signal: AbortSignal,
): Promise<CardStanding> {
  if (outcome.verdict === "requote_failed") {
    return { status: "open", reason: outcome.reason };
  }
  if (outcome.verdict === "locked" || outcome.verdict === "over_cap") {
    return { status: outcome.verdict };
  }
  if (outcome.verdict === "reopened" || outcome.verdict === "card_changed") {
    return { status: "open" };
  }
  const { closing } = intent.stored;
  if (closing === undefined) {
    return unknown;
  }
  const settled = await options.showings.settled(intent.record.id, { signal });
  if (settled === undefined) {
    return { status: "closed", closing };
  }
  const { ref: _ref, ...after } = settled;
  return { ...after, status: "closed" };
}

/**
 * Creates the {@link CardPresses}, the engine's adapter of Telegram's `CardAnswers` port. Only the
 * owner's numeric Telegram id counts; a press by anyone else, or on a reference no card version
 * has, answers nothing. The answer records `tg:<id>` as who answered.
 */
export function createCardPresses(options: CardPressesOptions): CardPresses {
  return {
    async answer(press, { signal }) {
      if (!(await pressedByOwner(options.ownerId, press.presserId, signal))) {
        return unknown;
      }
      const card = await options.intents.cardByRef(press.ref, { signal });
      if (card === undefined) {
        return unknown;
      }
      const answered = await options.answer(
        {
          intent: card.intentId,
          decision: press.decision,
          cardVersion: card.version,
          answeredBy: { surface: "telegram", by: `tg:${String(press.presserId)}` },
        },
        { signal },
      );
      return answered.ok ? standingOf(options, answered.value, signal) : unknown;
    },
  };
}
