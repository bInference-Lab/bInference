import type { Result } from "@binference/core";
import type {
  CardPress,
  CardStanding,
  LaunchDraftPress,
  LaunchDraftStanding,
  OwnerCall,
  OwnerChatOperation,
  QuestionPress,
  QuestionStanding,
} from "@binference/engine/surfaces";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";

/**
 * Takes the owner's answers to cards from Telegram; the engine owns it. It finds the card version
 * by its callback reference, checks that the presser is the owner's numeric Telegram id, and
 * stores the answer before it resolves. The first answer to a card wins (spec 4, section 2).
 */
export interface CardAnswers {
  /**
   * Answers a card for a press and says how the card stands. Rejects with the signal's reason
   * once it aborts, and answers nothing.
   */
  answer(press: CardPress, options: { readonly signal: AbortSignal }): Promise<CardStanding>;
}

/**
 * Takes the owner's presses of the agent's question buttons from Telegram; the engine owns it. It
 * finds the question by its button reference, checks that the presser is the owner's numeric
 * Telegram id, and stores the answer with its message for the agent before it resolves. The first
 * answer wins, so the agent hears it once (spec 4, section 2).
 */
export interface QuestionAnswers {
  /** Answers a question for a press and says how it stands. Rejects once the signal aborts. */
  answer(
    press: QuestionPress,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionStanding>;
}

/**
 * Takes the owner's presses of a launch draft's Start and Drop from Telegram; the engine owns it
 * (decision 0285). It finds the open draft by its button reference and checks that the presser is
 * the owner's numeric Telegram id; the owner's Start ends the draft and proposes its launch as the
 * owner on Telegram before it resolves, so a draft starts once.
 */
export interface LaunchDraftAnswers {
  /** Starts or drops a draft for a press and says how it stands. Rejects once the signal aborts. */
  answer(
    press: LaunchDraftPress,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchDraftStanding>;
}

/**
 * Runs the operations of the owner's fast commands inside the engine; the engine owns it. An
 * operation runs only for the owner's numeric Telegram id, as the owner on Telegram, so what it
 * changes is journaled and announced as done from Telegram.
 */
export interface OwnerCalls {
  /**
   * Answers the operation's result, or the protocol error code it refused with: `auth.scope` for
   * a sender who is not the owner, `protocol.unknown_op` for an operation the engine does not
   * serve. Rejects with the signal's reason once it aborts, and runs nothing.
   */
  call<N extends OwnerChatOperation>(
    request: OwnerCall<N>,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ResultOf<N>, ProtocolErrorCode>>;
}
