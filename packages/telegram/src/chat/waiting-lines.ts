import type { Logger } from "@binference/core";
import type { BotCalls } from "../ingress/bot-calls.js";

/** Where a status line sits in the owner's chat. */
interface LineAt {
  readonly chatId: number;
  readonly messageId: number;
}

/**
 * The status lines that say a turn's proposal waits for the owner's answer on its card, kept by
 * the cards the turn showed, so each goes once its card closes and none outlives it.
 */
export interface WaitingLines {
  /** Notes a card that opened while these turns ran: their waiting lines wait on it. */
  shown(intent: string, turns: Iterable<string>): void;
  /** Whether a turn's status line waits on cards that all closed already, so it is not sent. */
  isAnswered(statusKey: string, turn: string): boolean;
  /** Keeps a sent status line of a turn that waits on the turn's cards; no other line is kept. */
  keep(statusKey: string, turn: string, at: LineAt): void;
  /**
   * A card closed: removes each line that waited on it, once. One Telegram no longer has counts as
   * removed; a removal that fails is logged and the line stays.
   */
  closed(intent: string, call: { readonly signal: AbortSignal }): Promise<void>;
}

// The status lines that wait on a card: `turn.proposalWaits` and `turn.moreProposals`.
const waitingKeys: ReadonlySet<string> = new Set(["turn.proposalWaits", "turn.moreProposals"]);
// The turns and the closed cards remembered, newest last; far more than one chat has at once.
const kept = 64;

/** Where the lines live: each turn's cards, the lines by card, and the cards that closed. */
interface Held {
  readonly cardsOf: Map<string, Set<string>>;
  readonly byCard: Map<string, LineAt[]>;
  readonly closed: string[];
}

function waitsOn(held: Held, statusKey: string, turn: string): readonly string[] {
  return waitingKeys.has(statusKey) ? [...(held.cardsOf.get(turn) ?? [])] : [];
}

// The lines that waited on a card leave every card they waited on.
function takeLines(held: Held, intent: string): readonly LineAt[] {
  const lines = held.byCard.get(intent) ?? [];
  const gone = new Set(lines.map((line) => line.messageId));
  for (const [card, waiting] of held.byCard) {
    const left = waiting.filter((line) => !gone.has(line.messageId));
    if (left.length === 0) {
      held.byCard.delete(card);
    } else {
      held.byCard.set(card, left);
    }
  }
  return lines;
}

/** Creates the {@link WaitingLines} of the owner's chat, held in memory, removed through `bot`. */
export function createWaitingLines(bot: BotCalls, logger: Logger): WaitingLines {
  const held: Held = { cardsOf: new Map(), byCard: new Map(), closed: [] };
  return {
    shown(intent, turns) {
      for (const turn of turns) {
        held.cardsOf.set(turn, new Set([...(held.cardsOf.get(turn) ?? []), intent]));
      }
      [...held.cardsOf.keys()].slice(0, -kept).forEach((turn) => held.cardsOf.delete(turn));
    },
    isAnswered(statusKey, turn) {
      const cards = waitsOn(held, statusKey, turn);
      return cards.length > 0 && cards.every((card) => held.closed.includes(card));
    },
    keep(statusKey, turn, at) {
      for (const card of waitsOn(held, statusKey, turn)) {
        held.byCard.set(card, [...(held.byCard.get(card) ?? []), at]);
      }
    },
    async closed(intent, call) {
      held.closed.push(intent);
      held.closed.splice(0, Math.max(0, held.closed.length - kept));
      for (const line of takeLines(held, intent)) {
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one removal at a time, in the chat's pace
          await bot.deleteMessage(line.chatId, line.messageId, call);
        } catch {
          call.signal.throwIfAborted();
          logger.info("telegram.chat_line_kept", { messageId: line.messageId });
        }
      }
    },
  };
}
