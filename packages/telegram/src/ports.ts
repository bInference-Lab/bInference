import type { Result } from "@binference/core";
import type {
  CardPress,
  CardStanding,
  OwnerCall,
  OwnerChatOperation,
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
