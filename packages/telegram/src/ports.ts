import type { Id, Result } from "@binference/core";
import type {
  CardPress,
  CardStanding,
  OwnerCall,
  OwnerChatOperation,
} from "@binference/engine/surfaces";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { CardCopy } from "./cards/card-copy.js";
import type { OwnerBinding } from "./owner/owner-binding.js";

/**
 * Keeps which Telegram user owns the install. One owner at a time: the first binding stays until
 * the owner removes it from the CLI.
 */
export interface OwnerStore {
  /** The owner, or `undefined` before pairing. Rejects with the signal's reason once it aborts. */
  get(options: { readonly signal: AbortSignal }): Promise<OwnerBinding | undefined>;
  /** Binds the owner; with an owner already bound it changes nothing and is `bound`. */
  bind(
    binding: OwnerBinding,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<OwnerBinding, "bound">>;
}

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

/** Keeps where each card version was posted in Telegram, so every copy can become its receipt. */
export interface CardCopyStore {
  /** Keeps a copy; keeping the same message again changes nothing. */
  keep(copy: CardCopy, options: { readonly signal: AbortSignal }): Promise<void>;
  /** The copies of the card version with this callback reference, in the order kept. */
  find(ref: string, options: { readonly signal: AbortSignal }): Promise<readonly CardCopy[]>;
  /** The copies of every version of an intent's card, the oldest version first. */
  ofIntent(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly CardCopy[]>;
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
