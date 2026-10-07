import type { ChainRegistry } from "@binference/chain";
import type { AnswerCard, AnsweredCard } from "../operations/answer-card.js";
import type { IntentStore } from "../ports.js";
import type { CardPress, CardStanding } from "./card-press.js";
import { paperReceiptOf } from "./paper-receipt.js";

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
  readonly ownerId: (options: { readonly signal: AbortSignal }) => Promise<number | undefined>;
  /** The registry the assets of a paper receipt are named from. */
  readonly chains: ChainRegistry;
}

const unknown: CardStanding = { status: "unknown" };

// A card that closed without a closing, as a cancel closes it, has no receipt to show. A paper
// intent filled at once when confirmed, so its receipt shows the fill.
function standingOf({ outcome, intent }: AnsweredCard, chains: ChainRegistry): CardStanding {
  if (outcome.verdict === "requote_failed") {
    return { status: "open", reason: outcome.reason };
  }
  if (outcome.verdict === "reopened" || outcome.verdict === "card_changed") {
    return { status: "open" };
  }
  const { closing } = intent.stored;
  const paper = paperReceiptOf(intent.history, chains);
  if (closing === undefined) {
    return unknown;
  }
  return paper === undefined ? { status: "closed", closing } : { status: "closed", closing, paper };
}

/**
 * Creates the {@link CardPresses}, the engine's adapter of Telegram's `CardAnswers` port. Only the
 * owner's numeric Telegram id counts; a press by anyone else, or on a reference no card version
 * has, answers nothing. The answer records `tg:<id>` as who answered.
 */
export function createCardPresses(options: CardPressesOptions): CardPresses {
  return {
    async answer(press, { signal }) {
      signal.throwIfAborted();
      const owner = await options.ownerId({ signal });
      if (owner === undefined || owner !== press.presserId) {
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
      return answered.ok ? standingOf(answered.value, options.chains) : unknown;
    },
  };
}
