import type { Clock } from "@binference/core";
import type { CardClosing, QuoteFailure, SimulationFailure } from "@binference/engine";
import type { CardPress, CardStanding } from "@binference/engine/surfaces";
import type { CardValueView } from "@binference/protocol";
import type { CardAnswers } from "../ports.js";

/** The engine's side of card answers in memory, with handles a test drives it by. */
export interface FakeCardAnswers extends CardAnswers {
  /** Opens a card version under its callback reference. */
  open(ref: string): void;
  /**
   * The next answer to `ref` leaves the card open, as a failed re-quote does, or as a Confirm of a
   * live intent does while the engine is locked.
   */
  refuseNext(ref: string, reason: Refusal, values?: ReasonValues): void;
  /** Closes a card as another surface or the card timer would. */
  close(ref: string, closing: CardClosing): void;
  /** Every press that closed a card or was refused, in order: what the engine stored. */
  answered(): readonly CardPress[];
}

/** What {@link createFakeCardAnswers} needs: the time answers carry, and the owner's id. */
export interface FakeCardAnswersOptions {
  readonly clock: Clock;
  readonly ownerId: number;
}

/** Why the fake leaves a card open: a failed re-quote, a locked engine, or the rolling cap. */
type Refusal = QuoteFailure | SimulationFailure | "locked" | "over_cap";

/** What a re-quote's reason may name, as the engine gives it: a chain, a name, a wallet. */
type ReasonValues = Readonly<Record<string, Extract<CardValueView, { readonly type: "text" }>>>;

interface CardState {
  readonly closing?: CardClosing;
  readonly refusal?: Refusal;
  readonly values?: ReasonValues;
}

function refused(refusal: Refusal, values: ReasonValues | undefined): CardStanding {
  if (refusal === "locked" || refusal === "over_cap") {
    return { status: refusal };
  }
  return values === undefined
    ? { status: "open", reason: refusal }
    : { status: "open", reason: refusal, reasonValues: values };
}

/**
 * Creates the engine's side of card answers in memory, for tests: the first answer from the owner
 * closes a card, and every later one sees that closing.
 */
export function createFakeCardAnswers(options: FakeCardAnswersOptions): FakeCardAnswers {
  const cards = new Map<string, CardState>();
  const answered: CardPress[] = [];
  const decide = (press: CardPress, card: CardState): CardStanding => {
    if (card.closing !== undefined) {
      return { status: "closed", closing: card.closing };
    }
    answered.push(press);
    if (card.refusal !== undefined) {
      cards.set(press.ref, {});
      return refused(card.refusal, card.values);
    }
    const outcome = press.decision === "confirm" ? "confirmed" : "denied";
    const answeredBy = { surface: "telegram", by: `tg:${String(press.presserId)}` } as const;
    const closing: CardClosing = { outcome, answeredBy, atMs: options.clock.now() };
    cards.set(press.ref, { closing });
    return { status: "closed", closing };
  };
  return {
    answer: async (press, call) => {
      call.signal.throwIfAborted();
      const card = cards.get(press.ref);
      const isOwners = press.presserId === options.ownerId;
      return Promise.resolve(
        card === undefined || !isOwners ? { status: "unknown" } : decide(press, card),
      );
    },
    open: (ref) => {
      cards.set(ref, {});
    },
    refuseNext: (ref, reason, values) => {
      cards.set(ref, values === undefined ? { refusal: reason } : { refusal: reason, values });
    },
    close: (ref, closing) => {
      cards.set(ref, { closing });
    },
    answered: () => [...answered],
  };
}
